# Continuity and analysis

This page is for writers and agents who want to know what the `story` CLI can check about a manuscript, and what to do when it finds something. It covers the continuity engine (deaths, casts, promises, questions, clues, state, prop custody, clock, and route travel), exemptions, and the analysis commands: `knowledge`, `timeline`, `pacing`, `clues`, `grid`, `prose`, `voices`, `names`, `diagram`, `progress`, `compare`, `passes`, `report`, `next`, and `doctor`.

All of them are read-only except three:

- `story progress --log` adds or replaces today's entry in `progress.md`.
- `story passes` with `--init`, `--start`, or `--done` rewrites the `revision-passes` list in `story.md`.
- `story diagram --out` writes the diagram to a file.

All of these commands are deterministic. They read your markdown frontmatter and chapter prose, never call a model, never rewrite prose, and give the same answer every time for the same files. They only flag contradictions that the frontmatter makes visible. Judgement calls, such as whether a character acts on knowledge they have not learned yet, are left to you or to the [`revision-continuity`](../skills/revision-continuity/SKILL.md) skill.

For flags and exit codes of every command, see the [CLI reference](cli-reference.md). For the full field list of each file, see the [Project format reference](project-format.md).

**On this page**

- [At a glance](#at-a-glance)
- [Find your message](#find-your-message)
- [Story continuity](#story-continuity): [how findings are reported](#how-findings-are-reported), [deaths](#deaths-and-posthumous-appearances), [status progressions](#status-progressions), [casts](#casts-and-locations), [promises, questions, and clues](#promises-questions-and-clues), [state](#continuity-state), [prop custody](#prop-custody), [clock](#clock-and-travel-time), [route travel](#route-travel), [worked example](#worked-example-fixing-the-unraveled-thread)
- [Exemptions](#exemptions)
- [Story knowledge](#story-knowledge)
- [Story timeline](#story-timeline)
- [Story pacing](#story-pacing)
- [Story clues](#story-clues)
- [Story grid](#story-grid)
- [Story prose](#story-prose)
- [Story voices](#story-voices)
- [Story names](#story-names)
- [Story diagram](#story-diagram)
- [Story progress](#story-progress)
- [Story compare](#story-compare)
- [Story similarity](#story-similarity)
- [Story passes](#story-passes)
- [Report, next, and doctor](#report-next-and-doctor)
- [When to run what](#when-to-run-what)

## At a glance

| Command | Answers |
|---------|---------|
| [`story continuity [path]`](#story-continuity) | Does the recorded story contradict itself? |
| [`story knowledge <id> --at <chapter-id>`](#story-knowledge) | What did this character know by this chapter? |
| [`story context <id>`](cli-reference.md#context) | What does an agent need to draft this chapter or scene, without spoilers from later chapters? |
| [`story timeline [path]`](#story-timeline) | What order do events happen in story time? Whose book is it? Who disappears? |
| [`story pacing [path]`](#story-pacing) | Do scenes cost the characters enough, do chapters end with a pull, and are any chapters out of proportion? |
| [`story clues [path]`](#story-clues) | Where is each clue planted and revealed, and does the mystery play fair? |
| [`story grid [path]`](#story-grid) | Which chapters advance each arc, which beat does each chapter carry, and how does it end? |
| [`story prose [path\|-]`](#story-prose) | Where does the prose lean on filter words, adverbs, said-bookisms, or off-sheet spellings? |
| [`story voices [path\|-]`](#story-voices) | How does each character talk, and do any two sound alike? |
| [`story names <name...>`](#story-names) | Is this candidate name already taken, or too close to one in use? |
| [`story mentions [<kind> <id>]`](#story-mentions) | Where does the prose name this character, place, or thing, and does each chapter's frontmatter agree with its prose? |
| [`story diagram <kind>`](#story-diagram) | What do the family tree, route map, timeline, clue flow, or arc map look like? |
| [`story progress [path]`](#story-progress) | How far along is the draft against its targets and deadline? |
| [`story compare [path]`](#story-compare) | How much did this revision pass change? |
| [`story similarity [path]`](#story-similarity) | Does any passage share a run of words with my earlier books, a draft, or a source? |
| [`story passes [path]`](#story-passes) | Which revision pass am I on, and what should it check? |
| [`story report [path]`](#story-report) | What is in this project and do the checks pass? |
| [`story next [path]`](#story-next) | What should I do next? |
| [`story doctor [path]`](#story-doctor) | What is broken and how do I repair it? |

Most commands take the project as an optional positional path or `--path`. `knowledge`, `names`, `mentions`, and `diagram` take only `--path`, because their positional arguments are a character id, candidate names, an entity kind and id, and a diagram kind.

Only `continuity` and `names` fail because of what the story says: `continuity` on a contradiction, `names` on a candidate that is already taken. The others exit 1 only on files that do not parse, and 2 on bad arguments. `pacing`, `clues`, `prose`, `voices`, and `similarity` findings are always warnings, and `report`, `next`, and `doctor` exit 0 whatever the checks find. For when each command exits 1, see [Output streams and exit codes](cli-reference.md#output-streams-and-exit-codes).

## Find your message

Every finding starts with a severity and, usually, a file path. Match the rest of the line against this table to jump to the explanation and fix.

| The finding contains | Command | Explained in |
|----------------------|---------|--------------|
| `lists <id>, who died in`, `who died before the story`, `has died-in`, `died-in references missing chapter`, `learn something in` | `continuity` | [Deaths and posthumous appearances](#deaths-and-posthumous-appearances) |
| `whose progressions make them deceased`, `sets status … while <id> is dead`, `when they die in`, `which still holds when they are revived` | `continuity` | [Status progressions](#status-progressions) |
| `POV character <id> is not listed in characters`, `but its scenes are told by`, `does not list them in characters or mentions`, `does not list that location`, `who has status: cut`, `Chapter numbering skips` | `continuity` | [Casts and locations](#casts-and-locations) |
| `in mentions but never names it` | `mentions` | [Story mentions](#story-mentions) |
| `pays off in … before it is planted`, `resolves in … before it is introduced`, `no payoff chapter`, `no planted chapter`, `no plant chapter`, `has no resolved chapter`, `status is still open`, `status is still planned` | `continuity` | [Promises, questions, and clues](#promises-questions-and-clues) |
| `has no payoff yet`, `payoff chapter … has passed`, `has no resolution yet` | `continuity` | [Unfired setups](#unfired-setups-the-chekhov-warning) |
| `story.md is complete but` | `continuity` | [Finishing the book](#finishing-the-book) |
| `current-chapter … is behind`, `current-chapter … is ahead`, `state.md … references missing`, `is missing knows`, `repeats fact`, `must be a kebab-case id`, `conflicts with`, `must be a mapping` | `continuity` | [Continuity state](#continuity-state) |
| `uses <artifact>, destroyed/lost since`, `mentions <artifact>, destroyed/lost since`, `destroyed/lost before the story`, `references missing since chapter` | `continuity` | [Prop custody](#prop-custody) |
| `timestamp runs backward`, `allows only …h for travel` (or `allows at most …h`), `is earlier than Chapter`, `malformed date`, `malformed time`, `negative travel-hours` | `continuity` | [Clock and travel time](#clock-and-travel-time) |
| `puts <character> at <location> …, but the fastest route takes`, `at the same time as` | `continuity` | [Route travel](#route-travel) |
| `dismissed:` | `continuity`, and any command reporting a warning an exemption names by code | [Exemptions](#exemptions) |
| `has no hook`, `end in an outright yes`, `with no sequel`, `end on resolution`, `the median chapter` | `pacing` | [Pacing findings](#pacing-findings) |
| `never planted: readers cannot play fair`, `late plant`, `lists no characters`, `red herring with no payoff`, `no clue is significance-delayed` | `clues` | [Fair-play findings](#fair-play-findings) |
| `filter words per 1,000`, `-ly adverbs per 1,000`, `said-bookism dialogue tags`, `sentence lengths are uniform`, `have similar first names` | `prose` | [What each line measures](#what-each-line-measures) |
| `style sheet prefers`, `british dialect prefers`, `american dialect prefers` | `prose` | [The style sheet](#the-style-sheet) |
| `which is in their voice-avoid list`, `from their voice-words list`, `may sound alike` | `voices` | [Voice findings](#voice-findings) |
| `clashes with`, `looks like`, `shares an initial with` | `names` | [Story names](#story-names) |
| `Unknown diagram kind` | `diagram` | [Story diagram](#story-diagram) |
| `Revision pass names must be kebab-case`, `Fix revision-passes in story.md` | `passes` | [Story passes](#story-passes) |
| `is not a story project: missing story.md` | any | The folder has no `story.md`. Pass the project root, or run `story init` first. |

## Story continuity

```shell
story continuity .
```

`story continuity` runs every check below and prints the findings. [`examples/the-unraveled-thread`](../examples/the-unraveled-thread/) is broken on purpose: every file is well-formed, so `story validate` and `story links` pass, but the story does not hold together.

```text
$ story continuity examples/the-unraveled-thread
Continuity check failed: 4 errors, 3 warnings, 0 dismissed
error: chapters/chapter-04.md lists edran-vale, who died in chapter-02; move posthumous appearances to mentions
error: continuity/promises/the-broken-compass.md pays off in chapter-02 before it is planted in chapter-03
error: continuity/questions/who-burned-the-mill.md resolves in chapter-02 before it is introduced in chapter-03
error: continuity/state.md knowledge-state[0] references missing chapter chapter-05
warning: chapters/chapter-03.md POV character nessa-thorn is not listed in characters [pov-not-in-cast]
warning: continuity/promises/the-sealed-letter.md was planted in chapter-01, 3 chapters ago, and has no payoff yet [promise-unpaid]
warning: continuity/state.md object-state[0] status active conflicts with worldbuilding/artifacts/vales-compass.md status destroyed [state-status-conflict]
```

[Fixing the unraveled thread](#worked-example-fixing-the-unraveled-thread) walks through repairing each of these.

Reader-order ledgers use chapter numbers: `planted` and `payoff` on a promise or clue, and `introduced` and `resolved` on a question. Deaths and revivals (`died-in`, `revived-in`), progressions (`from`), knowledge (`learned-in`), and object history (`since`) use story time when both chapters are dated on different days (a chapter's `date`, or else its earliest dated scene), and chapter number otherwise. All of these fields are chapter ids (`chapter-02`).

When only some chapters are dated, that rule can go in a circle. With chapter 2 dated a day after chapter 5 and chapters 3 and 4 undated, chapter 3 comes after 2 and chapter 5 after 4 by number, but 2 comes after 5 by date. So the story order gives an undated chapter the latest date among the chapters read before it, and compares chapters by that date, then by number. An undated chapter then always comes after every chapter read before it, and a flashback dated before an earlier chapter also comes before the undated chapters read since then. That example reads 1, 5, 2, 3, 4. Every check, sort, and command uses this one order, so `story continuity`, `story knowledge`, `story series`, and `story diagram` agree, and Bun and Node give the same result. Where the rule above does not go in a circle, the order is the same as that rule. A planned `chapter-NN` with no file yet is placed as an undated chapter with that number would be.

### How findings are reported

`continuity`, `timeline`, `pacing`, `clues`, `prose`, `voices`, `names`, `progress`, `compare`, and `similarity` all report the same way. On stderr they print one summary line first, like the first line above, and then each finding on its own line:

- **error** lines are contradictions. They make the command exit 1.
- **warning** lines are things that are probably wrong or stale. They never change the exit code.
- **dismissed** lines are findings that match an entry in `continuity/exemptions.md`, or warnings a `story.md` [`severity`](cli-reference.md#defaults-and-severity-from-storymd) entry turned off. They are shown so nothing is hidden, but they do not count as errors or warnings. `continuity` applies every exemption; an entry that names a warning's `code` also applies wherever that warning is reported. See [Exemptions](#exemptions).

The report itself (timeline sections, pacing and clue grids, prose counts, voice profiles, progress figures) goes to stdout, so you can redirect it to a file without the findings. File paths in findings are relative to the project root, so you can open them directly.

### What the checker reads

| File | Fields |
|------|--------|
| `characters/*.md` | `status`, `died-in`, `revived-in`, `relationships`, and `status` entries in `progressions` |
| `worldbuilding/locations/*.md` | `routes` |
| `worldbuilding/factions/*.md` | the file itself: a faction id is accepted as an `object-state` `owner` |
| `plot/arcs/*.md` | `characters` |
| `chapters/chapter-NN.md` | `number`, `status`, `pov`, `characters`, `mentions`, `locations`, `date`, `time`, `strand`, and the names in its prose |
| `scenes/*.md` | `chapter`, `scene`, `pov`, `characters`, `mentions`, `location`, `state-changes`, `date`, `time`, `travel-hours` |
| `continuity/promises/*.md` | `status`, `planted`, `payoff` |
| `continuity/questions/*.md` | `status`, `introduced`, `resolved` |
| `continuity/clues/*.md` | `status`, `planted`, `payoff` |
| `continuity/state.md` | `current-chapter`, `character-state`, `knowledge-state`, `object-state` |
| `worldbuilding/artifacts/*.md` | `status` (and the file itself, for `object-state` `artifact`) |
| `story.md` | `status` |
| `continuity/exemptions.md` | `exemptions` |

A file that fails to parse is reported as an error, and the rest of the project is still checked.

### Deaths and posthumous appearances

A character with `died-in: chapter-NN` must have `status: deceased`, and must not appear in the cast of any later chapter or scene. A character counts as appearing when they are the `pov` or are listed in `characters`. Flashbacks, memories, letters, recordings, and ghosts belong in `mentions`, which the death check ignores.

A character with `status: deceased` and no `died-in` died before the story starts, so any appearance in a chapter or scene cast is a warning.

Some story shapes need more than one death chapter:

- **Posthumous narrator.** A chapter or scene whose `pov` is also in its `mentions` is narrated by someone who is not physically there, such as a ghost or a narrator looking back after their death. It is not a posthumous appearance, and the POV-not-in-characters warning is skipped.
- **Planned death.** While the `died-in` chapter is still `status: outline`, the death is planned, not in force. The character may stay `status: alive`, and a later chapter or scene may still list them or have them learn something. Set `status: deceased` when you draft that chapter; later casts and learning are then posthumous.
- **Resurrection.** `revived-in: chapter-NN` ends the dead window. Casts after `died-in` and before `revived-in` are still errors; from the revival chapter on, the character may appear again. Once the revival chapter is drafted, the status must no longer be `deceased`, unless a status progression after the revival makes them `deceased` again in a drafted chapter (a [second death](#status-progressions)).
- **Non-linear chronology.** "Later" means later in story time when both chapters are dated (a chapter's `date`, or else its earliest dated scene), and later by chapter number otherwise, except where [only some chapters are dated](#story-continuity) and that goes in a circle. A character who dies in a 2024 chapter 3 cannot appear in a 2034 prologue read as chapter 1, and in a dual-timeline book a death in the 2020 strand does not stop the character appearing in the 1990 strand.
- **Branching books.** Once any chapter has [`choices`](project-format.md#branching-chapters), "later" also needs a path of choices from one chapter to the other. A death on one branch is not a posthumous appearance on a sibling branch, and a chapter two branches rejoin at is checked against both: if either branch kills the character, listing them there is an error. A revival counts only when every path from the death passes through it. Knowledge and progressions follow the same paths. Chapters in one loop, and chapters no path reaches, compare by date and then by number.

```yaml
# characters/edran-vale.md
name: Edran Vale
status: deceased
died-in: chapter-02
```

| Severity | Message | Fix |
|----------|---------|-----|
| error | `<character> has died-in <chapter> but status <status>; set status: deceased` | Set `status: deceased`, or remove `died-in` if the character survives. |
| error | `<character> died-in references missing chapter <chapter>` | Point `died-in` at a chapter that exists. |
| error | `<character> has revived-in <chapter> but no died-in; set died-in or remove revived-in` | Record the death the revival ends, or drop `revived-in`. |
| error | `<character> revived-in references missing chapter <chapter>` | Point `revived-in` at a chapter that exists. |
| error | `<character> is revived in <chapter>, not after dying in <chapter>` | The revival must come after the death in story time. |
| error | `<character> has revived-in <chapter> but status deceased; set status: alive` | The revival chapter is drafted, so the character is alive again. A status progression to `deceased` after the revival (a second death) makes `deceased` correct once its chapter is drafted, and this error is not reported. |
| error | `<chapter or scene> lists <id>, who died in <chapter>; move posthumous appearances to mentions` | Move the id from `characters` to `mentions`. For a dead POV narrator, keep `pov` and add the id to `mentions`. If they really are alive, fix `died-in`, or add `revived-in`. |
| warning | `<chapter or scene> lists <id>, who died before the story (deceased with no died-in); move appearances to mentions` | Move the id from `characters` (or `pov`) to `mentions`. If they die during the story, set `died-in`. |
| error | `continuity/state.md knowledge-state[<n>] has <id> learn something in <chapter>, after they died in <chapter>` | Learning is on-page, like an appearance. Move `learned-in` to a chapter at or before the death, or give the knowledge to a living character. |
| error | `<scene> state-change has <id> learn something in <chapter>, after they died in <chapter>` | A scene `state-changes` entry with `character` and `knowledge` is learning in that scene's chapter, even when an earlier `knowledge-state` entry already records the fact. Drop the state change, or give the knowledge to a living character. |
| warning | `continuity/state.md knowledge-state[<n>] has <id> learn something in <chapter>, but <id> died before the story (deceased with no died-in)` | Drop `learned-in` (pre-existing knowledge), or set `died-in` if they die during the story. |

### Status progressions

A character's [progressions](project-format.md#progressions) can change `status` partway through the story. The checker resolves the status at each chapter with the progressions that take effect by then, in the same story order as `died-in`: by date when both chapters are dated, else by chapter number. A progression from a planned `chapter-NN` with no file yet compares as an undated chapter with that number would, as it does for `story knowledge --at`: a death planned for chapter 20 affects nothing while the book stops at chapter 12, but one planned for an unwritten chapter 3 applies to a written chapter 4. A scene whose chapter does not exist keeps the frontmatter status.

- **A progression to `deceased`, with no `died-in`,** works like `died-in`: the chapter it takes effect in is the death chapter, and a later chapter or scene that lists the character in `characters` or `pov` is a posthumous appearance, as is learning something in a later chapter. `mentions` and a POV also in `mentions` are fine, as for `died-in`. A later status progression (to `alive`, say) ends the dead window. `story validate` still asks for `died-in` alongside the progression (`deceased-without-died-in`) for the first death in the book, but not for a later one after a revival, since `died-in` holds only one death. Once `died-in` is set, the death checks above take over and these warnings stop, so nothing is reported twice.
- **A character dead before the story** (`status: deceased`, no `died-in`) may appear from the chapter a status progression brings them back. A progression that repeats `deceased` does not move their death, so appearances before and after it are both reported as dead before the story.
- **Other commands.** [`story series`](series.md#what-it-checks) reads the same deaths and revivals at the end of each earlier book, so a character killed by a progression in book one is dead in book two, and [`story diagram relationships`](#story-diagram) marks each character dead or revived at the end of the book.
- **`continuity/state.md`** should stop tracking a character in `character-state` once a progression makes them `deceased` at `current-chapter`, as for `died-in` (`state-tracks-dead-character`). A death in an `outline` chapter is planned, so it does not count yet.
- **With `died-in`,** status progressions must agree with it. A status set by a progression that still holds at the `died-in` chapter (`missing` from chapter 1, say, with no progression to `deceased`) contradicts the death, as does a progression that sets another status (`alive`, `missing`) after the death chapter and before `revived-in`, and a progression to `deceased` that still holds when the character is revived. A progression to `deceased` in another chapter than `died-in` is reported by `story validate`, but one after `revived-in` is a second death, which `died-in` cannot record because it holds the first. `revived-in` brings the character back, so no progression to `alive` is needed before it. Later appearances and learning are reported as for a death with no `died-in`, and once that chapter is drafted, `status: deceased` is correct at the end of the book.

```yaml
# characters/ada-fenn.md
status: alive
progressions:
  - from: chapter-03
    field: status
    value: deceased
```

All of these are warnings, so a `severity` entry in `story.md` can promote or silence each code (see [Finding codes](cli-reference.md#finding-codes)).

| Severity | Message | Fix |
|----------|---------|-----|
| warning | `<chapter or scene> lists <id>, whose progressions make them deceased from <chapter>; move appearances after the death to mentions` | Move the id from `characters` (or `pov`) to `mentions`, add a status progression if they come back, or set `died-in` to the progression's chapter. Code `progression-deceased-in-cast`. |
| warning | `<file> has <id> learn something in <chapter>, but their progressions make them deceased from <chapter>` | Move `learned-in` to the death chapter or earlier, or give the knowledge to a living character. Code `progression-deceased-learning`. |
| warning | `<character> progressions[<n>] leaves <id> <status> when they die in <chapter>; add a status progression to deceased from <chapter>` | Add a progression setting `status: deceased` from the `died-in` chapter. Code `progression-death-conflict`. |
| warning | `<character> progressions[<n>] sets status <status> from <chapter>, while <id> is dead after dying in <chapter>; …` | Set `revived-in` to that chapter if they come back, move the progression to the `revived-in` chapter, or drop it. Code `progression-death-conflict`. |
| warning | `<character> progressions[<n>] makes <id> deceased from <chapter>, which still holds when they are revived in <chapter>; add a status progression from <chapter>` | Add a progression setting `status` (usually `alive`) from the revival chapter. Code `progression-death-conflict`. |
| warning | `continuity/state.md character-state[<n>] tracks <id>, whose progressions make them deceased from <chapter>; remove the entry once they are dead` | Remove the entry. Code `state-tracks-dead-character`. |

Other statuses are not checked against casts. A `missing` character can still be on the page: in their own point of view, or with whoever holds them. `imprisoned` is not a `status` value; record it as a progression on its own field (`field: whereabouts`), which the checker does not read. Location `controlled-by` progressions are not checked either, since no scene or chapter field records who controls a place, and matching a faction's name in scene outlines would flag every scene that talks about the old rulers.

### Casts and locations

These checks keep the scene records and the chapter frontmatter in step, so the cast lists that other checks rely on can be trusted.

| Severity | Message | Fix |
|----------|---------|-----|
| warning | `<chapter or scene> POV character <id> is not listed in characters` | Add the POV character to `characters`. |
| warning | `<chapter> has POV <id> but its scenes are told by <ids>` | The chapter's `pov` matches none of its scenes' `pov` values. Correct whichever is wrong. Scenes with no `pov` are not counted. |
| warning | `<scene> lists <id> but <chapter> does not list them in characters or mentions` | Add the character to the parent chapter's `characters` or `mentions`. |
| warning | `<chapter> names character <id> ("<name>") but does not list them in characters or mentions` | The chapter's prose names a character its `pov`, `characters`, and `mentions` leave out. Add them to `characters` if they are on the page, or to `mentions` if they are only talked about or remembered. If the name belongs to someone or something else (a word that is also a name), exempt the finding. See [Story mentions](#story-mentions) for how names are matched. Code `named-not-listed`. |
| warning | `<scene> is set in <location> but <chapter> does not list that location` | Add the location to the chapter's `locations`. |
| warning | `<chapter or scene> lists <id>, who has status: cut; drop them from pov and characters` | Finish the cut: take the character out of `pov` and `characters`, or set their `status` back if they return. |
| warning | `<arc> lists <id>, who has status: cut; drop them from characters` | Take the character out of the arc's `characters`. |
| warning | `<character> has a relationship with <id>, but <id> has status: cut; drop the relationship on both sides` | Remove the relationship from both character files. A relationship between two cut characters is not reported. |
| warning | `Chapter numbering starts at <n>, not 1` | Chapters before the first are missing, usually after `story remove chapter` or an unfinished `story move`. Add them, or renumber with `story move chapter <id> --number 1`. |
| warning | `Chapter numbering skips from <n> to <m>` | Add the missing chapter, or close the gap with `story move chapter <id> --number <n>`. Scaffolding a far-off chapter ahead of time also triggers this. |

### Promises, questions, and clues

These three ledgers track what the book owes its reader. Each is a folder of markdown files under `continuity/`, created with `story add promise`, `story add question`, and `story add clue`:

| Ledger | Folder | Chapter fields | Statuses |
|--------|--------|----------------|----------|
| Promises (setups and payoffs) | `continuity/promises/` | `planted`, `payoff` | `planned`, `planted`, `paid-off`, `dropped`, `abandoned` |
| Questions (mysteries the reader is asking) | `continuity/questions/` | `introduced`, `resolved` | `open`, `answered`, `resolved`, `dropped`, `abandoned` |
| Clues (fair-play evidence) | `continuity/clues/` | `planted`, `payoff` | `planned`, `planted`, `paid-off`, `dropped`, `abandoned` |

```yaml
# continuity/clues/torn-ledger-page.md
title: Torn Ledger Page
status: planted
planted: chapter-01
payoff: chapter-04
significance-delayed: true
characters:
  - jonas-reed
arcs: []
```

`story add promise` and `story add clue` default to `status: planted` when `--planted` names an existing chapter, and to `planned` otherwise, including when `--planted` names a chapter not written yet. `story add question` defaults to `open`, or to `answered` when you pass `--resolved`; `--status open` with `--resolved` is an error. Clues accept two more flags: `significance-delayed: true` (`--significance-delayed`) for evidence whose meaning the reader should only see later, and `red-herring: true` (`--red-herring`) for evidence that points the wrong way. `story continuity` checks clues exactly like promises and ignores both flags; [`story clues`](#story-clues) uses them for its fair-play checks.

Entries with `status: abandoned` are skipped entirely. Everything else is checked:

| Severity | Message | Fix |
|----------|---------|-----|
| error | `<promise or clue> pays off in <chapter> before it is planted in <chapter>` | Swap or correct `planted` and `payoff`. |
| error | `<question> resolves in <chapter> before it is introduced in <chapter>` | Swap or correct `introduced` and `resolved`. |
| error | `<promise> is paid-off but has no payoff chapter` (clues: `has status paid-off but no payoff chapter recorded`) | Record `payoff`. |
| error | `<promise> is planted but has no planted chapter` (clues: `is planted but no plant chapter recorded`) | Record `planted`, or set the status back to `planned`. |
| error | `<question> is answered` or `is resolved` `but has no resolved chapter` | Record `resolved`. |
| error | `<question> records resolved chapter <chapter> but status is still open` | Set `status: resolved` (or `answered`), or clear `resolved`. |
| warning | `<promise or clue> records planted chapter <chapter> but status is still planned` | Set `status: planted` once the setup is on the page. The warning appears only once that chapter has prose: its own `status` is not `outline`, even when later chapters are drafted. |

`story links` separately checks that the chapter ids in these fields exist, with one allowance for scheduling ahead. A promise or clue may name a `chapter-NN` that has no chapter file yet in `payoff`, and in `planted` while its status is `planned`; a question may name one in `introduced` while its status is `open`; and a research note may name one in `used-in`. The number must be 1 or more and must not belong to an existing chapter under another id, so `chapter-1` beside `chapter-01`, or `chapter-00`, is reported as a missing chapter. Once the status is `planted` or `paid-off`, the `planted` chapter must exist, and once it is `paid-off`, the `payoff` chapter must exist too. A question's `introduced` chapter must exist once it is no longer `open`, and its `resolved` chapter must always exist; scaffold the chapter first (`story add chapter 'Title' --number 7`). Outline chapters satisfy the link check without counting as drafted.

#### Unfired setups (the Chekhov warning)

A promise or clue with `status: planted` gets a warning as soon as its recorded `payoff` chapter has been drafted (its own `status` is not `outline`), however soon after the plant that is. An outline payoff chapter does not count, even when later chapters are drafted out of order. A scheduled `chapter-NN` with no file yet counts as drafted once the latest drafted chapter reaches its number. With no `payoff` recorded, it gets one once three or more chapters follow its `planted` chapter, up to the latest drafted chapter. The gap counts chapter files, not chapter numbers, so chapters 2 and 10 are one chapter apart. The latest drafted chapter is the highest-numbered chapter whose `status` is not `outline`, so scaffolding outline chapters ahead of time does not trigger the warning.

| Situation | Result |
|-----------|--------|
| `payoff` recorded for a chapter not drafted yet (an outline, or a scheduled `chapter-NN` ahead of the latest drafted chapter) | No warning: the payoff is scheduled |
| `payoff` recorded for a chapter already drafted | warning: `<file> payoff chapter <chapter> has passed and status is still planted` |
| No `payoff` recorded, planted fewer than 3 chapters ago | No warning |
| No `payoff` recorded, planted 3 or more chapters ago | warning: `<file> was planted in <chapter>, <n> chapters ago, and has no payoff yet` |

Fix it by paying the setup off and setting `status: paid-off`, by recording a future `payoff` chapter, by setting `status: dropped` or `abandoned` if you cut the thread, or with an [exemption](#exemptions) if the gap is deliberate (for example, the payoff is in the next book).

An open question with no `resolved` chapter gets the same kind of warning, on a wider gap. It fires once twelve or more chapters follow its `introduced` chapter, up to the latest drafted chapter, and only once the `introduced` chapter itself is past `outline`: a question scheduled into an outline chapter is not on the page yet. The count is the same one: chapter files, not chapter numbers, and outline chapters scaffolded past the draft do not count. Twelve is the default because a mystery's central question is often the book and should stay open through a long stretch of chapters. The finding is a warning, `question-unanswered`. An unanswered question is an error only when `story.md` is `status: complete`.

| Situation | Result |
|-----------|--------|
| `status: open`, no `resolved`, introduced fewer than 12 chapters ago | No warning |
| `status: open`, no `resolved`, introduced 12 or more chapters ago | warning: `<file> was introduced in <chapter>, <n> chapters ago, and has no resolution yet` |
| `status: open` with `resolved` set | The error in the table above (`status is still open`); no gap warning |
| `answered`, `resolved`, `dropped`, or `abandoned` | No gap warning |

Answer it and set `status: answered` or `resolved`, or set `status: dropped` or `abandoned` if you cut the thread. A question meant to stay open — the central mystery, or one that pays off in the next book — takes an [exemption](#exemptions) with `code: question-unanswered` and the question's `file`. To silence the warning for every open question, set that code's [`severity`](cli-reference.md#defaults-and-severity-from-storymd) to `off` in `story.md`. Recording a future `resolved` chapter while the status is still `open` is the error above, so it does not schedule the answer the way a promise's `payoff` does.

#### Finishing the book

When `story.md` has `status: complete`, every ledger must be closed:

| Severity | Message |
|----------|---------|
| error | `story.md is complete but <promise or clue> is still planned` or `is still planted` |
| error | `story.md is complete but <question> is still open` |

Pay each one off, mark it `dropped` or `abandoned`, or set the story back to `revising`.

### Continuity state

`continuity/state.md` records the facts that must carry forward from chapter to chapter. The tables in its body are for reading; the checker reads only the frontmatter lists.

```yaml
# continuity/state.md
type: continuity-state
story: the-unraveled-thread
current-chapter: 4
character-state:
  - character: jonas-reed
    location: the-mill-row
    physical: smoke-scarred hands
    emotional: cornered
knowledge-state:
  - character: jonas-reed
    knows: which ledger page names the firestarter
    learned-in: chapter-04
object-state:
  - artifact: vales-compass
    owner: jonas-reed
    location: the-mill-row
    status: destroyed
    since: chapter-02
```

| List | Checked fields | Free-form fields |
|------|----------------|------------------|
| `character-state` | `character` must be a character id; `location`, when set, must be a location id | anything else, such as `physical` and `emotional` |
| `knowledge-state` | `character` must exist; `knows` is required; `learned-in`, when set, must be a chapter id; `fact`, when set, must be a kebab-case id, unique per character | none |
| `object-state` | `artifact` must be an artifact id; `owner` must be a character or faction id; `location` must be a location id; `status` must be an artifact status and match the artifact file; `since`, when set, must be a chapter id | anything else |

Keep one `character-state` entry per character and one `object-state` entry per artifact and `since` chapter; a repeat is a warning. Several `object-state` entries for one artifact with different `since` chapters are its history (see [Prop custody](#prop-custody)); only the latest is compared with the artifact file's `status`. `story validate` also warns about a key that looks like a misspelt checked key, such as `learned_in` or `since_chapter` in a state entry or `died_in` in a character file (it checks every kind of file this way; see [Frontmatter syntax](project-format.md#frontmatter-syntax)), because a missing `learned-in`, `since`, or `died-in` means "before the story".

| Severity | Message | Fix |
|----------|---------|-----|
| error | `continuity/state.md current-chapter <n> is ahead of the latest chapter <m>` | Lower `current-chapter` to a chapter that exists. |
| warning | `continuity/state.md current-chapter <n> is behind the latest chapter <m>; update continuity state after drafting` | Bring the state up to date with the chapters you drafted, then raise `current-chapter`. Outline chapters do not count. |
| error | `... <list>[<i>] references missing character`, `location`, `artifact`, `owner`, or `chapter <id>` | Correct the id, or create the missing entity. |
| error | `... knowledge-state[<i>] is missing knows` | Add `knows`. |
| error | `... knowledge-state[<i>] fact <id> must be a kebab-case id` | Use lowercase words joined by hyphens. |
| error | `... knowledge-state[<i>] repeats fact <id> for <character> from knowledge-state[<j>]` | Keep one entry per fact per character. |
| warning | `... object-state[<i>] status <a> conflicts with <artifact file> status <b>` | Make the artifact file and the state entry agree. |
| warning | `... character-state[<i>] repeats character <id> from character-state[<j>]` or `object-state[<i>] repeats artifact <id> ...` | Merge the entries into one, or give an artifact's entries different `since` chapters. |
| error | `... <list>[<i>] must be a mapping` | Each list item must be a `key: value` block, not a bare string. |

The checker also compares the state with the scene records and deaths it summarises. Scene checks cover scenes in chapters up to `current-chapter`. All of these are warnings (knowledge learned after a death is an error, listed under [Deaths and posthumous appearances](#deaths-and-posthumous-appearances)):

| Message | Fix |
|---------|-----|
| `<scene> state-changes record <character> learning "<text>" but continuity/state.md has no knowledge-state entry for it learned by <chapter>` | Each scene `state-changes` entry with `character` and `knowledge` needs a `knowledge-state` entry for that character, learned in that chapter or earlier. Entries match by an optional `fact` id on both, then by the same text (ignoring case and a final full stop), then one-to-one with an entry learned in the same chapter. Add the entry. |
| `... knowledge-state[<i>] has <character> learn something in <chapter>, which does not list <character> in characters or pov` | Add the character to that chapter's or one of its scenes' cast, or correct `learned-in`. Outline chapters are skipped. |
| `... character-state[<i>] tracks <character>, who died in <chapter>; remove the entry once they are dead` | The death is drafted and the character is dead at `current-chapter` in story time (the death chapter itself counts, a revival ends it), so drop the entry. |
| `... character-state[<i>] puts <character> at <location>, but their last scene in <chapter>, <scene>, is at <location> and the chapter does not list <location>` | Update the state location. The check uses the `current-chapter` scenes, and accepts any location the chapter lists, since the character can move on after their last scene. |
| `... object-state[<i>] gives <artifact> owner <id>, but <scene> state-changes last set it to <id>` (or `location`) | A scene `state-changes` entry with `target: <artifact>` and `owner` or `location` changed the artifact after its latest `object-state` entry. Update the entry, or add a new one with a later `since`. |
| `<scene> state-changes set <artifact> owner <id> but continuity/state.md has no object-state entry for <artifact>` | Add an `object-state` entry. |

The optional `fact` id lets `story series` match the same piece of knowledge across books; see [Series](series.md). To ask what a character knew at a given point, use [`story knowledge`](#story-knowledge).

### Prop custody

Once an artifact is destroyed or lost, later chapters should not use it. Record the chapter it was destroyed or lost in as `since` on its `object-state` entry:

```yaml
object-state:
  - artifact: vales-compass
    status: destroyed
    since: chapter-02
```

After that chapter, the checker reports any scene whose `state-changes` target the artifact, and any chapter or scene that lists it in `mentions` (chapter and scene `mentions` accept artifact ids as well as character ids, so `story links` passes while `story continuity` catches the late reference). From a copy of the [repaired unraveled thread](#worked-example-fixing-the-unraveled-thread), where the compass is destroyed `since: chapter-02`, with the compass brought back in chapter 4:

```text
error: scenes/chapter-04-scene-01.md uses vales-compass, destroyed/lost since chapter-02
error: chapters/chapter-04.md mentions vales-compass, destroyed/lost since chapter-02
```

Chapter 4 lists `vales-compass` in its `mentions`, and its scene has this state change, which the checker matches by `target`:

```yaml
state-changes:
  - target: vales-compass
    change: Jonas finds the compass needle in the lock gate
```

| Severity | Message | Fix |
|----------|---------|-----|
| error | `<scene> uses <artifact>, destroyed/lost since <chapter>` | Remove or retarget the state change, or move `since` if the artifact survives longer. |
| error | `<chapter or scene> mentions <artifact>, destroyed/lost since <chapter>` | Drop the mention, or exempt it if the chapter only remembers the object. |
| error | `<scene> uses <artifact>, destroyed/lost before the story` | The entry has no `since`, so the artifact was gone before chapter 1. Remove or retarget the state change, or add `since` if it is destroyed or lost during this book. |
| error | `continuity/state.md object-state[<i>] references missing since chapter <chapter>` | Point `since` at an existing chapter. |

Only `object-state` entries with `status: destroyed` or `status: lost` are custody-checked. References in or before the `since` chapter are allowed.

To record a loss that ends, add a second entry for the same artifact with a later `since` and another status. The loss window then runs from the first `since` to the second, and the recovery chapter itself may use the artifact. Only a loss ends this way: a destroyed artifact stays destroyed, so a later entry does not end a window that contains a `destroyed` entry:

```yaml
object-state:
  - artifact: vales-compass
    status: lost
    since: chapter-02
  - artifact: vales-compass
    owner: jonas-reed
    status: active
    since: chapter-04
```

Chapter 3 is still checked; chapters 4 on are not. Consecutive `lost` and `destroyed` entries form one window that starts at the earliest, so each late reference is reported once. "Later" means later in story time, as for [deaths](#deaths-and-posthumous-appearances): the history, the latest entry, and the windows all order `since` chapters by date when both are dated, and by chapter number otherwise.

An entry with no `since` means the artifact was destroyed or lost before this story, for example in an earlier book of a series. Every scene whose `state-changes` target it is then an error, while `mentions` stay allowed, since characters can still remember it.

### Clock and travel time

Ordering and travel checks switch on as soon as any scene or chapter has a `date`. Malformed dates and times, and `travel-hours` on a scene with no `date`, are reported either way.

| Field | On | Format |
|-------|----|--------|
| `date` | scene or chapter | A real calendar day, `YYYY-MM-DD` (years 0000 to 9999), or a day of the book's [custom calendar](project-format.md#custom-calendars) |
| `time` | scene or chapter | `HH:MM` (24-hour, or up to the calendar's [`hours-per-day`](project-format.md#hours-per-day)) or a named part of day |
| `travel-hours` | scene | A YAML number (not a quoted string): the minimum hours of travel needed to reach this scene from the previous one. `story validate` rejects any other value; inside `story continuity` it is treated as 0, which switches the travel check off. |

Named parts of day cover a span of the clock, the same spans the [route check](#route-travel) uses: `dawn` 04:00-06:59, `morning` 05:00-11:59, `midday` 11:00-13:59, `afternoon` 12:00-17:59, `evening` 17:00-21:59, `night` 20:00-23:59. The clock checks read each at its most generous, so only an order or a journey that is impossible on every reading is reported. (`story timeline` sorts them as fixed points: `dawn` 05:00, `morning` 07:00, `midday` 12:00, `afternoon` 15:00, `evening` 19:00, `night` 23:00.) These spans and points are for a 24-hour day. Under a calendar's [`hours-per-day`](project-format.md#hours-per-day), each covers the same share of the day: multiply by `hours-per-day / 24`, so on a 30-hour day `night` is 25:00-29:59 and sorts at 28:45, and a `24:00` scene after a `night` scene on the same day runs backward. `HH:MM` needs two-digit hours (`09:00`, not `9:00`). Quoting `HH:MM` times (`time: "22:00"`) keeps other YAML tools from reading them as numbers.

A book with a [custom calendar](project-format.md#custom-calendars) in `story.md` writes its dates in that calendar, such as `3 Thaw 302 AE`. Every check here reads them as days of that calendar, so a book set in a secondary world gets the same clock, travel, and order checks. A calendar-shaped date that is not a day of it (`31 Thaw 302 AE` in a 30-day month) is a `story validate` error (`invalid-date`), and other text is free text, as below. A calendar with [`hours-per-day`](project-format.md#hours-per-day) also sets the length of the day: times run to its last minute (`29:59` for 30 hours), a journey across midnight counts that many hours per day, and each named part of day covers the same share of it (`night` is 25:00-29:59 of 30 hours).

`story add chapter` and `story add scene` reject a bad `--date`, `--time`, or `--travel-hours` when they create the file. `story validate` rejects a non-numeric `travel-hours`, a `date` or `time` that is not a single value, and a `YYYY-MM-DD` date that is not a real calendar day (`2024-13-45`, or `2023-02-29` outside a leap year) as `invalid-date`. It does not check other date text or time formats, so a date such as `Midwinter` or a malformed time you type by hand is only reported by `story continuity`, as the warnings below. `story continuity` also warns about an impossible day, so it says why the clock checks skip that unit.

The checker walks the same units as [`story timeline`](#story-timeline), in reading order: each chapter's scenes by scene number, or the chapter itself when it has no scene records. A chapter's `date` and `time` apply only when it stands in for its scenes this way. It keeps a reference point, the earliest moment the story can have reached so far. For each dated unit:

- A unit whose latest reading is still before the reference is a **backward timestamp** warning: an earlier date, or the same date with a time that cannot fall after it (`10:20` then `morning` is fine, since morning runs to 11:59; `evening` then `dawn` is not). A unit that runs backward (a flashback, or a misdated unit) does not become the reference, so the units after it are still checked against the main line.
- If the reference itself was out of place (a flash-forward prologue that the following units all fall before), the first unit after it is reported and the story continues from there, so one outlier gives one warning.
- An untimed unit on the reference's day could happen at any time that day: it is never backward against that day, and the reference keeps its known time. Likewise a named time that could start before the reference's time leaves the reference in place.
- If the scene has `travel-hours` and both it and the reference have a time, the hours between them, at their widest reading, must be at least `travel-hours`, or it is an error.

In the same copy, the scenes carry these dates. Chapter 3's scene is set the night before chapter 2's, and chapter 4's scene asserts a 30-hour journey from the scene before it:

| Scene | `date` | `time` | Other |
|-------|--------|--------|-------|
| `chapter-01-scene-01` | `1924-10-14` | `night` | |
| `chapter-02-scene-01` | `1924-10-21` | `morning` | |
| `chapter-03-scene-01` | `1924-10-20` | `"22:00"` | `flashback-to: the night of the fire` |
| `chapter-04-scene-01` | `1924-10-21` | `"23:30"` | `travel-hours: 30` |

Chapter 3's scene runs backward, so it gets a warning, no travel check, and does not become the reference. Chapter 4 is then measured from chapter 2's scene (`morning`, which can start as early as 05:00), at most 18.5 hours earlier. The clock findings from that run (alongside the custody errors above) are:

```text
error: scenes/chapter-04-scene-01.md allows at most 18.5h for travel of 30h
warning: scenes/chapter-03-scene-01.md timestamp runs backward [clock-backward]
```

| Severity | Message | Fix |
|----------|---------|-----|
| warning | `<scene> timestamp runs backward` | Correct the date or time. If the scene is a deliberate flashback, add an [exemption](#exemptions) for it. |
| error | `<scene> allows only <x>h for travel of <y>h` | Move the scene later, shorten the journey, or lower `travel-hours`. |
| error | `<scene> allows at most <x>h for travel of <y>h` | As above. `at most` means one of the two units has a named part of day, and even its widest reading is too short. |
| warning | `Chapter <n> date <date> is earlier than Chapter <m> date <date>` | A chapter with no scene records runs backward. The dates include the times when both fall on the same day, and the reference may be a scene file instead of a chapter. Correct the chapter date, or exempt a flashback chapter. |
| warning | `<scene> has travel-hours but no date, so the clock check skips it` | Add a `date` (and `time`) so the journey can be checked. |
| warning | `<scene> has malformed date "<value>"`, `has malformed time "<value>"`, `has negative travel-hours <n>` | Use `YYYY-MM-DD`, `HH:MM` or a named part of day, and a number of hours that is zero or more. A scene with a malformed date is left out of the clock checks. |
| warning | `Chapter <n> has malformed date "<value>"` or `malformed time "<value>"` | As above. |

A dual-timeline book can give each chapter a `strand`, such as `1990` or `2020`. Each strand keeps its own reference point, so switching from a 2020 chapter to a 1990 one is not a backward timestamp, while a 1990 chapter dated before an earlier 1990 chapter still is. Chapters without `strand`, and their scenes, share one strand. The route check reads `strand` the same way: a character's sightings are compared only within one strand, so the same person at the mill in the 1990 strand and the keep in the 2020 strand on one calendar is not a journey. A crossing from one strand to another is not inferred. The scene records have no field for it, so a real crossing stays on one strand, where the route check can see it, or an intentional finding is an [exemption](#exemptions).

Scenes with `flashback-to` are still checked. That field is a free-form note (for example `flashback-to: the night of the fire`) that `story timeline` displays; it does not suppress the backward-timestamp warning.

### Route travel

`travel-hours` is a figure you assert scene by scene. Location `routes` let the checker work the journey out for itself. Each route on a location names another location and the fastest journey there, in hours:

```yaml
# worldbuilding/locations/port-kestrel.md
routes:
  - to: bellwether-reef
    hours: 0.5
    mode: dive skiff
```

| Field | Meaning |
|-------|---------|
| `to` | A location id. `story links` reports `route references missing location <id>` and `route points at itself`. |
| `hours` | The fastest journey, as a positive number. `story validate` rejects zero, negative, and quoted values. |
| `mode` | Optional free text, such as `dive skiff` or `cart`. `story diagram locations` prints it on the edge. |

A location that lists the same destination twice uses only the fastest route; `story validate` warns about the repeat. `story diagram locations` draws exactly the routes the checker uses.

A route is two-way unless the destination records its own route back, in which case each direction uses its own hours (a river that is quicker downstream, for example). The checker finds the fastest path through any number of places, so a harbour-to-mill route and a mill-to-keep route together give a harbour-to-keep time.

Once any location has a valid route, `story continuity` follows every character through the dated scene records of one chapter `strand`. Chapters without `strand`, and their scenes, share one strand. A character is sighted at a scene's `location` when they are its `pov` (or, for a scene with no `pov`, its chapter's `pov`, as `story timeline` shows it) or are listed in its `characters`; `mentions` do not count. For each sighting, the checker looks back at every earlier sighting of the same character in that strand at a different place connected by routes, and reports an error if even the fastest route could not cover the distance in the time between them. Each scene is reported at most once per character. Sightings in another strand are a different timeline, not the other end of a journey: a character at the mill in strand `1990` at 09:00 and at the keep in strand `2020` at 09:20 on the same date does not outrun a route between them. A journey that really crosses strands is not inferred. Keep those scenes on one strand so the check can see the journey, or record an intentional finding as an [exemption](#exemptions).

Scene times are read generously, so only journeys that are impossible on any reading are reported:

| Scene `time` | Treated as |
|--------------|-----------|
| `HH:MM` | That exact minute |
| `dawn` | 04:00 to 06:59 |
| `morning` | 05:00 to 11:59 |
| `midday` | 11:00 to 13:59 |
| `afternoon` | 12:00 to 17:59 |
| `evening` | 17:00 to 21:59 |
| `night` | 20:00 to 23:59 |
| none | Any time that day |

The spans are for a 24-hour day. Under a calendar's [`hours-per-day`](project-format.md#hours-per-day), each covers the same share of the day (multiply by `hours-per-day / 24`: `night` is 25:00 to 29:59 on a 30-hour day), and a scene with no time runs to the day's last minute.

Scenes without a valid `date` or without a `location` are left out. The route check runs alongside the `travel-hours` check and does not replace it.

No journey takes no time, so a character in two scenes of the same strand at different places at the same exact `HH:MM` on the same day is an error even when the places have no route between them, or the project has no routes at all. Places joined by a route get the route message instead. A named time or an untimed scene could be a different moment, so it never triggers this.

From a copy of [`examples/harbor-of-second-light`](../examples/harbor-of-second-light/), whose Port Kestrel file carries the route above. The copy dates chapter 1's reef scene `2041-03-02` at `"05:40"`, and adds a second scene in which Mara is on the council steps in Port Kestrel twenty minutes later (`story add scene "Council Steps" --chapter chapter-01 --location port-kestrel --pov mara-quill --character mara-quill --date 2041-03-02 --time 06:00`):

```text
$ story continuity .
Continuity check failed: 1 errors, 0 warnings, 0 dismissed
error: scenes/chapter-01-scene-02.md puts mara-quill at port-kestrel 0.3h after scenes/chapter-01-scene-01.md at bellwether-reef, but the fastest route takes 0.5h
```

Hours are shown to 0.1h, with the gap rounded down and the route time rounded up, so a near miss (10.98h against 11h) never reads as two equal numbers.

| Severity | Message | Fix |
|----------|---------|-----|
| error | `<scene> puts <character> at <location> <n>h after <earlier scene> at <location>, but the fastest route takes <m>h` | Move the later scene later, move the character to a nearer place, or take them out of one scene's cast. If a faster way exists (a boat, a portal), add it as a route. |
| error | `<scene> puts <character> at <location> at the same time as <earlier scene> at <location>` | The two scenes share a date and exact time but name different places, with no route between them. Correct a time or a location, or take the character out of one scene's cast. |
| error | The same, with `at most <n>h` | As above. `at most` means one of the two scenes has a named part of day or no time, and even the widest reading is too short. Giving both scenes an `HH:MM` time makes the gap exact. |

Record routes with the [`worldbuilding`](../skills/worldbuilding/SKILL.md) skill, whose [`maps-and-routes.md`](../skills/worldbuilding/references/maps-and-routes.md) reference covers recording them. To see the network, run [`story diagram locations`](#story-diagram).

### Worked example: fixing the unraveled thread

Each finding in the [example output](#story-continuity) has a direct fix:

| Finding | Fix applied |
|---------|-------------|
| `chapters/chapter-04.md lists edran-vale, who died in chapter-02` | Chapter 4 recalls Edran rather than showing him, so move `edran-vale` from `characters` to `mentions`. |
| `the-broken-compass.md pays off in chapter-02 before it is planted in chapter-03` | The chapters were swapped: `planted: chapter-02`, `payoff: chapter-03`. |
| `who-burned-the-mill.md resolves in chapter-02 before it is introduced in chapter-03` | Same: `introduced: chapter-02`, `resolved: chapter-03`. |
| `knowledge-state[0] references missing chapter chapter-05` | Jonas learns it in chapter 4: `learned-in: chapter-04`. |
| `POV character nessa-thorn is not listed in characters` | Add `nessa-thorn` to chapter 3's `characters`. |
| `object-state[0] status active conflicts with ... status destroyed` | The compass was destroyed in chapter 2: set `status: destroyed` and `since: chapter-02`. |
| `the-sealed-letter.md was planted in chapter-01, 3 chapters ago` | Deliberate: the letter pays off in book two. Record an [exemption](#exemptions) for `promise-unpaid` in `continuity/promises/the-sealed-letter.md`. |

After those edits, in a copy of the project:

```text
$ story continuity .
Continuity is consistent: 0 errors, 0 warnings, 1 dismissed
dismissed: continuity/promises/the-sealed-letter.md was planted in chapter-01, 3 chapters ago, and has no payoff yet (exemption: The letter pays off in book two; the gap is deliberate.)
```

After any continuity fix, run the maintenance block (`story reindex .`, `story wordcount . --write`, and `story check .`) so registries and backlinks match and the fix is confirmed.

## Exemptions

Some findings are intentional: a flashback that runs the clock backward, a setup whose payoff is in a sequel, a chapter that names a destroyed heirloom in memory. Record those in `continuity/exemptions.md` instead of bending the frontmatter to silence the checker:

```markdown
---
type: exemption-log
exemptions:
  - code: promise-unpaid
    file: continuity/promises/the-sealed-letter.md
    reason: "The letter pays off in book two; the gap is deliberate."
  - code: clock-backward
    chapter: chapter-06
    reason: "Chapter 6 is a flashback to the night of the fire."
---

# Continuity Exemptions

Findings from `story continuity` that are intentional. Each entry needs a reason.
```

Each entry sets a `reason`, and either a `pattern` or a `code` with a `file`, `chapter`, or `pattern` to narrow it. It dismisses a finding when every key it sets matches:

| Key | Matches a finding when |
|---|---|
| `code` | The finding has this [code](cli-reference.md#finding-codes): the name in brackets at the end of a `warning:` line, or `code` in `--json`. |
| `file` | The finding is about this file, written relative to the project root as the finding names it (`chapters/chapter-03.md`). A `/` or `\` matches either separator. The whole path must match; a folder does not match the files in it. |
| `chapter` | The finding carries this chapter id. Only the findings listed below carry a chapter; an entry with `chapter` never matches any other finding. |
| `pattern` | The finding's text contains `pattern` as a plain, case-sensitive substring. There are no wildcards or regular expressions. Paths in the pattern match either separator. |

Prefer `code` with `file` (or `chapter`): the code names the rule and the file names the one place, so rewording a message never stops the entry from matching or makes it match something new. A `pattern` still works, alone or with the other keys, and every log written before `code`, `file`, and `chapter` existed behaves as it did. Copy the code and file from the finding, or from `story continuity --json`, where each diagnostic has `code`, `file`, and `chapter`.

These findings carry a chapter: `posthumous-appearance`, `deceased-in-cast`, `progression-deceased-in-cast`, `progression-death-conflict`, `pov-not-in-cast`, `pov-scene-mismatch`, `named-not-listed`, `mention-not-named`, `scene-cast-not-in-chapter`, `scene-location-not-in-chapter`, `cut-character-in-cast`, `posthumous-learning`, `deceased-learning`, `progression-deceased-learning`, `learner-not-in-cast`, `knowledge-not-recorded`, `state-tracks-dead-character`, `state-location-drift`, `object-not-recorded`, `state-object-drift`, `state-differs-by-path`, `gone-artifact-used`, `gone-artifact-mentioned`, `malformed-date`, `malformed-time`, `negative-travel-hours`, `travel-hours-undated`, `clock-backward`, `travel-too-fast`, `route-same-time`, and `route-too-fast`.

Their chapter is where the problem shows up: the chapter of the chapter or scene file the finding is about (a scene's `chapter` field), the `learned-in` chapter of a learning event, `current-chapter` for `state-tracks-dead-character`, `state-location-drift`, and `state-differs-by-path`, the chapter of the scene that last set the object for `object-not-recorded` and `state-object-drift`, and for `progression-death-conflict` the chapter of the death, the progression, or the revival it names. `story continuity --json` shows each finding's `chapter`. Findings about a whole character, promise, question, or clue, or about `story.md`, carry no chapter: match those with `file`. A scene with no `chapter` field gives its findings no chapter.

How matching works:

- The first matching entry wins, and its `reason` is printed after the dismissed finding. With `--json`, a dismissed diagnostic has `exemption` (the reason) and `exemptionIndex`, the entry's position in the list, as `story validate` numbers it (`exemptions[0]` is the first).
- In `story continuity`, both errors and warnings can be dismissed. The exit code depends only on the errors that remain.
- An entry that names a `code` also applies outside `continuity`: to that warning wherever it is reported, as a `story.md` [`severity`](cli-reference.md#defaults-and-severity-from-storymd) entry does. That includes `validate`, `links`, `prose`, `pacing`, `clues`, `voices`, `names`, `series`, `timeline`, `progress`, `compare`, the checks `report`, `next`, and `doctor` summarise, and the warnings `build`, `export`, `context`, `add`, `rename`, `move`, and `remove` print. Outside `continuity` an exemption dismisses only warnings: the errors other commands report mean the project is broken. An entry with no `code` applies only in `continuity`, as exemptions always have.
- An exemption applies before `severity`. A finding an entry matches is dismissed with the entry's reason even when `severity` promotes the rest of its code to an error or turns it off, so one deliberate case can stay dismissed while every other one fails the build.
- The pattern matches as written, including leading or trailing spaces, so `" ann, who died"` does not also dismiss the same finding for `joann`.
- An entry `story validate` rejects never dismisses anything, so a typo in one key cannot widen the entry to everything its other keys match.

`story validate` checks the file: `type` must be `exemption-log` and `exemptions` a list of mappings, and each entry needs a non-empty `reason` and at least one of `pattern`, `code`, `file`, and `chapter`. A key that looks like a misspelled one, such as `Code` or `files`, is an error (`exemption-misspelled-key`), since ignoring it would widen the entry. A `pattern` must be at least 4 characters after trimming whitespace (`exemption-pattern-too-short`). A `code` must be a finding code (`exemption-unknown-code`) that an exemption can dismiss: a warning a `severity` entry can name, or an error `continuity` reports (`exemption-code-not-dismissible`). A `file` must be relative to the project root, with no `..` segment (`exemption-file-not-relative`), and a `chapter` a kebab-case id. An entry with only a `code` is rejected as too broad (`exemption-too-broad`): it would dismiss every finding of that rule, so add a `file`, `chapter`, or `pattern`, or, for a warning, set its `severity` to `off` in `story.md`. So is an entry with a `file` or `chapter` but neither `code` nor `pattern`, which would dismiss every error and warning about that file or chapter. A `chapter` with a `code` whose findings carry no chapter could never match, so it is an error too (`exemption-chapter-not-carried`): use `file`. `story validate` warns (`stale-exemption`) when a `file` is not a file in the project (a folder never matches) or a `chapter` is not a chapter in `chapters/`, since the entry then matches nothing.

If the file is missing or does not parse, no exemptions apply. If it is refused as a symlink, a device, or a file over 5 MiB, `story continuity` reports that as an error rather than silently applying none. `story report`, `story next`, and `story doctor` count findings after exemptions. `rename` and `move` update the ids in a `pattern`, a `file` that is the renamed or moved entity's own file (or one of a moved chapter's scene files), and a `chapter` that moved, including the chapter of an entry whose scene moves to another chapter, so an entry stays with its finding; `remove` clears a `chapter` naming a removed chapter, as it does every reference field, and warns about entries whose `pattern` or `file` names the removed entity.

## Story knowledge

```shell
story knowledge <character-id> --at <chapter-id> [--path <project>]
```

`story knowledge` answers "did she know this yet?" from the `knowledge-state` list in `continuity/state.md`. `story context` uses the same rule for the POV character's knowledge. For the given character it lists, in file order, every fact the character knows at the chapter in story time:

- every entry without `learned-in`, marked `reader-knowledge, pre-existing`, and
- every entry whose `learned-in` chapter is not after the `--at` chapter. When both chapters are dated (a chapter's `date`, or else its earliest dated scene), this compares story dates, so knowledge learned in a 2034 prologue read as chapter 1 is not known in a 2024 chapter 2, and knowledge learned in that 2024 chapter is known in the prologue. Otherwise it compares chapter numbers.

A fact the reader has already been shown (its `learned-in` chapter number is at or before `--at`, or in a branching book, on a path of choices to `--at`) is marked `reader-knowledge, learned in <chapter>`. A fact the character knows from a later chapter that is earlier in story time is marked `character-knowledge, learned in <chapter>; not yet shown to the reader, do not reveal`: the character may act on it, and the fact must not be stated. In `story context`, a fact learned in the chapter being drafted is marked `reader-knowledge, learned in this chapter`. For a scene, such a fact is included only once an earlier scene's `state-changes` records it for the POV character, and is marked `reader-knowledge, learned in this chapter, scene N`.

From [`examples/the-last-ember`](../examples/the-last-ember/), where Kael's knowledge carries over from the previous book:

```text
$ story knowledge kael-voss --at chapter-01 --path examples/the-last-ember
- The tunnels from the Vale side reach the Whisper Gate into the High Keep (reader-knowledge, pre-existing)
```

In the repaired unraveled thread, Jonas learns which page matters in chapter 4:

```text
$ story knowledge jonas-reed --at chapter-03
No recorded knowledge for jonas-reed at chapter-03
$ story knowledge jonas-reed --at chapter-04
- which ledger page names the firestarter (reader-knowledge, learned in chapter-04)
```

The command exits 2 with `Unknown character <id>` or `Unknown chapter <id>` if either id does not exist, exits 3 with the parse error instead (such as `characters/mara.md: is missing YAML frontmatter`) when the character's file fails to parse, and exits 2 with the usage line if you leave out the character or `--at`. Entries whose `learned-in` chapter does not exist are skipped here; `story continuity` reports them as errors.

After the knowledge, it lists the character's [progressions](project-format.md#progressions) that apply by the `--at` chapter: changes such as a new `status`, a scar, or a title, each with the chapter it takes effect from and the value it replaced. A change planned for chapter 20 stays out of the answer for chapter 5, so an agent drafting chapter 5 does not write it in early:

```text
State at chapter-03:
- status: missing (from chapter-02, was alive)
```

The answer is only as good as the state file. After drafting a chapter in which someone learns something that matters later, add a `knowledge-state` entry with `learned-in`. Before revising a scene in which a character acts on a secret, run `story knowledge` for that chapter.

## Story timeline

```shell
story timeline .
```

`story timeline` is a read-only view. It never adds findings; `story continuity` owns the clock checks. It exits 1 only when a file does not parse. It prints up to four sections.

**Chronology (story order)** lists every dated scene sorted by date and time, then by reading order. An entry with a date but no valid time could happen at any time that day, so it keeps its reading position among that day's timed entries. A chapter with no scene files stands in for its scenes and uses the chapter's own `date` and `time`. A scene whose `chapter` has no chapter file is still listed, placed by the number in its chapter id and noted `no chapter file for <chapter>`. An entry is marked `told in chapter <n>, after later events` when something that happens strictly after it in story time was read before it: a later day, or a later time on the same day when both have a time. Scenes with `flashback-to` show that note too.

**Undated (reading order)** lists scenes and scene-less chapters with no valid date. The section is left out when everything is dated.

**POV balance** totals chapter `pov` by chapter count and prose length, largest share first. Length is in words, or in characters in a book [counted in characters](project-format.md#counting-in-characters), as in `story progress`. Chapters with no `pov` are grouped as `unspecified`.

**Character presence** counts the chapters in which each character appears in `characters` or as `pov` (on the chapter or on any of its scenes; `mentions` do not count). It shows the span from first to last appearance, the longest absence, and how many chapters at the end of the book they are missing from. For a character with `died-in` (and no `revived-in`), the trailing absence is expected, so the line reads `died in chapter <n>` instead. As in continuity, a death or revival in an `outline` chapter is planned, not written: a planned death leaves the ordinary trailing absence, and a planned revival still reads `died in chapter <n>`. Absences are counted in chapter positions, so gaps in chapter numbering do not inflate them.

With the scene dates from [Clock and travel time](#clock-and-travel-time) on the repaired unraveled thread:

```text
$ story timeline .
Timeline: 4 dated, 0 undated

Chronology (story order):
- 1924-10-14 night  chapter-01-scene-01: The Ash and the Ledger (POV jonas-reed, at the-mill-row)
- 1924-10-20 22:00  chapter-03-scene-01: The Dry Side of Mill Row (POV nessa-thorn, at the-mill-row) [told in chapter 3, after later events; flashback to the night of the fire]
- 1924-10-21 morning  chapter-02-scene-01: The Millpond (POV jonas-reed, at the-mill-row)
- 1924-10-21 23:30  chapter-04-scene-01: The Lock Gate (POV jonas-reed, at the-mill-row)

POV balance:
- jonas-reed: 3 chapters, 87 words (78%)
- nessa-thorn: 1 chapter, 24 words (22%)

Character presence:
- jonas-reed: 4 of 4 chapters, chapters 1-4
- edran-vale: 2 of 4 chapters, chapters 1-2, died in chapter 2
- nessa-thorn: 1 of 4 chapters, chapter 3, absent from the last 1 chapter
Timeline built: 0 errors, 0 warnings, 0 dismissed
```

Without dates, the chronology reads `- None: add date (YYYY-MM-DD) and time to scenes or chapters to order them` and every scene is listed under `Undated (reading order)`. POV balance and presence still work. The unmodified example, where chapter 4 still lists Edran, shows a longest absence. Chapter 3 omits Nessa from `characters`, but she is its `pov`, so she still counts as present there:

```text
$ story timeline examples/the-unraveled-thread
...
Character presence:
- jonas-reed: 4 of 4 chapters, chapters 1-4
- edran-vale: 3 of 4 chapters, chapters 1-4, longest absence 1 chapter after chapter 2, died in chapter 2
- nessa-thorn: 1 of 4 chapters, chapter 3, absent from the last 1 chapter
```

A character no chapter or scene lists in `characters` or `pov` reads `not present in any chapter`.

Read it for:

- **Scenes told out of order.** Every `told in chapter` marker should be a flashback or a deliberate reordering. If it is not, a date is wrong.
- **POV share.** A POV character with a large share of the book, or one who narrates a single chapter, is a structural choice worth confirming.
- **Vanishing characters.** A long `longest absence`, or a supporting character absent from the last several chapters, often means a dropped subplot. A character `not present in any chapter` is either still to come or a candidate to cut.

To draw the chronology as a picture, run [`story diagram timeline`](#story-diagram).

## Story pacing

```shell
story pacing .
```

`story pacing` is a dashboard of how each chapter moves. It reads frontmatter only, never prose meaning, and every finding is a warning, so it exits 0 on any readable project. Three optional fields drive it:

| Field | On | Values | Meaning |
|-------|----|--------|---------|
| `outcome` | scene | `yes`, `no`, `yes-but`, `no-and` | Whether the POV character gets what they wanted in the scene. `yes-but` (they get it at a cost) and `no-and` (they fail and things get worse) are the complicating outcomes. |
| `sequel` | scene | `true` | The scene is a sequel unit: the character reacts, weighs a `dilemma`, and decides. Sequels are counted separately and their `outcome` is ignored. |
| `hook` | chapter | `cliffhanger`, `question`, `revelation`, `reversal`, `decision`, `emotional`, `resolution` | How the chapter's last page pulls the reader on. `resolution` is the one ending that lets them put the book down. |

Set them with `story add scene --outcome yes-but`, `story add scene --sequel --dilemma '<text>'`, and `story add chapter --hook question`, or by hand. `story validate` rejects any other `outcome` or `hook` value.

From [`examples/the-unraveled-thread`](../examples/the-unraveled-thread/):

```text
$ story pacing examples/the-unraveled-thread
Pacing: 4 scenes, 0 sequels, 4 of 4 chapters with hooks
Outcomes: 75% of recorded outcomes are setbacks or complications
Median chapter: 28 words

Ch  Words  Scenes  Sequels  Outcomes (yes/no/yes-but/no-and)  Hook
 1     34       1        0  0/0/1/0                           question
 2     31       1        0  0/0/0/1                           decision
 3     24       1        0  1/0/0/0                           revelation
 4     22       1        0  0/0/1/0                           cliffhanger
Pacing check complete: 0 errors, 1 warnings, 0 dismissed
warning: 4 scene units in a row with no sequel (chapter-01-scene-01 to chapter-04-scene-01): give the POV character room to react and decide [pacing-no-sequel]
```

How to read it:

- **The header** counts scenes (not sequels), sequels, and chapters with a `hook`. The outcome line is the share of recorded outcomes that are anything but `yes`; a book where most scenes go the hero's way has little pressure. The median is taken over chapters that have prose.
- **Each row** is one chapter in number order: its prose words, its scene and sequel records (matched by the scene's `chapter`), the count of each outcome, and its hook, or `-` if none is set.
- Scene records are what count. A chapter with no scene files shows zero scenes and zero outcomes, so run `story add scene` for each scene you want measured.

### Pacing findings

| Message | Appears when | Fix |
|---------|--------------|-----|
| `<chapter> has no hook: record how the chapter ending pulls the reader on` | A chapter with status `draft`, `revised`, `final`, or `complete` has no `hook`. Outline chapters are not flagged. | Decide how the chapter ends and record it. If the ending does not pull, rewrite the last page. |
| `<n> scenes in a row end in an outright yes (<first> to <last>): raise the cost with yes-but or no-and` | Three or more consecutive non-sequel scenes, in reading order across chapters, have `outcome: yes`. A scene with another outcome, or none, breaks the run; a sequel does not. | Make one of the wins cost something (`yes-but`) or fail (`no`, `no-and`). |
| `<n> scene units in a row with no sequel (<first> to <last>): give the POV character room to react and decide` | Four or more consecutive scene records with no `sequel: true` between them. | Add a sequel beat where the character absorbs the last setback and chooses what to do next, and record it with `story add scene --sequel`. Fast thrillers can leave this warning standing. |
| `<n> chapters in a row end on resolution (<first> to <last>): readers can put the book down` | Three or more consecutive chapters have `hook: resolution`. | End at least one of them on an open question, decision, or reversal, or merge chapters so the calm sits mid-chapter. |
| `<chapter> runs <n> words, over twice the median chapter (<m>): consider splitting it` | At least three chapters have prose and this one is more than twice the median. | Split it at a scene break, or accept a deliberately long set piece. |
| `<chapter> runs <n> words, under half the median chapter (<m>): check it earns its place` | As above, under half the median. | Merge it with a neighbour, expand it, or keep it as a deliberate short chapter. |

In a copy of the unraveled thread with chapters 2 to 4 ending in `outcome: yes` scenes and `hook: resolution`, and a sequel scene added to chapter 1 (`story add scene "Jonas Counts the Cost" --chapter chapter-01 --pov jonas-reed --character jonas-reed --sequel --dilemma "Burn the ledger or read it"`), the no-sequel run is broken and the other two warnings appear:

```text
Ch  Words  Scenes  Sequels  Outcomes (yes/no/yes-but/no-and)  Hook
 1     34       1        1  0/0/1/0                           question
 2     31       1        0  1/0/0/0                           resolution
 3     24       1        0  1/0/0/0                           resolution
 4     22       1        0  1/0/0/0                           resolution
Pacing check complete: 0 errors, 2 warnings, 0 dismissed
warning: 3 scenes in a row end in an outright yes (chapter-02-scene-01 to chapter-04-scene-01): raise the cost with yes-but or no-and [pacing-easy-wins]
warning: 3 chapters in a row end on resolution (chapter-02 to chapter-04): readers can put the book down [pacing-resolution-run]
```

The thresholds are rules of thumb, not rules. The [`scene-craft`](../skills/scene-craft/SKILL.md) and [`plot-structure`](../skills/plot-structure/SKILL.md) skills explain the scene and sequel pattern, and the `chapter-writing` skill runs `story pacing` after each chapter.

## Story clues

```shell
story clues .
```

`story clues` is the fair-play view of the clue ledger (`continuity/clues/`). It draws a grid of which chapter plants each clue and which reveals it, and warns about what a mystery reader would call cheating. `story continuity` still owns the hard errors, such as a clue revealed before it is planted; everything here is a warning, so the command exits 0 on any readable project.

It reads these clue fields:

| Field | Used for |
|-------|----------|
| `planted`, `payoff` | The `P` and `R` cells, and the late-plant and unplanted checks |
| `status` | Only `planned`, `planted`, and `paid-off` clues are checked. `dropped` and `abandoned` clues still get a grid row but no findings. |
| `characters` | Who could notice the clue |
| `red-herring` | `true` for false evidence. Marked `~` in the grid; its `payoff` is the chapter that debunks it. |
| `significance-delayed` | `true` when the clue is shown before the reader can understand it. Marked `delayed` in the grid. |

From [`examples/the-unraveled-thread`](../examples/the-unraveled-thread/), which carries three clues, two of them flawed on purpose:

```text
$ story clues examples/the-unraveled-thread
Clues: 3 live (1 red herring), 3 planted, 2 revealed

Clue                       1  2  3  4
edrans-margin-notes        P  .  .  R  paid-off, delayed
the-constables-silence ~   .  P  .  .  planted
the-burned-page            .  .  P  R  paid-off

P planted, R revealed, x both, ~ red herring
Clue check complete: 0 errors, 2 warnings, 0 dismissed
warning: clue the-constables-silence is a red herring with no payoff: record the chapter that debunks it [clue-herring-unresolved]
warning: clue the-burned-page is planted in the chapter before its reveal (chapter-03 -> chapter-04): late plant gives readers no time to notice it [clue-late-plant]
```

The columns are chapter numbers, in order. Rows are sorted by the chapter that plants them; clues with no `planted` chapter come last. `x` means planted and revealed in the same chapter. After each row come the clue's status and `delayed` if the flag is set. The header counts live clues (`planned`, `planted`, or `paid-off`), how many are planted (status `planted` or `paid-off`, with a `planted` chapter that exists), and how many are revealed (status `paid-off`, with a `payoff` chapter that exists). A `planned` clue that only schedules its chapters counts as neither.

### Fair-play findings

| Message | Fix |
|---------|-----|
| `clue <id> is revealed in <chapter> but never planted: readers cannot play fair` | Plant the clue earlier and record `planted`, or cut the reveal's reliance on it. |
| `clue <id> is planted in the same chapter as its reveal` or `in the chapter before its reveal (<planted> -> <payoff>): late plant gives readers no time to notice it` | Move the plant at least two chapters before the reveal. Distance is counted in chapter positions, so gaps in numbering do not help. |
| `clue <id> lists no characters: record who could notice it` | List the characters who see, hear, or could find the clue. A clue no one can notice is not fair evidence. |
| `clue <id> is a red herring with no payoff: record the chapter that debunks it` | Write the scene that explains the false lead away, and set `payoff` to its chapter. |
| `no clue is significance-delayed: every clue announces its meaning when planted` | Appears once the book has three or more live clues that are not red herrings and none has `significance-delayed: true`. Hide at least one clue in plain sight, and set the flag. |

To see the same plant-to-reveal flow as a picture, run [`story diagram clues`](#story-diagram). The [`genre-craft`](../skills/genre-craft/SKILL.md) skill's [mystery fair-play reference](../skills/genre-craft/references/mystery-fair-play.md) covers planting technique and red-herring discipline.

## Story grid

```shell
story grid .
story grid . --format csv --from 10 --to 20
```

Prints the plot grid of arcs by chapter, the outliner view Plottr and Scrivener give: a row per arc with an `x` in each chapter whose frontmatter, or one of whose scenes, lists the arc in `arcs-advanced`, then a `(beat)` row of each chapter's [`beat`](project-format.md#chapters) once any chapter has one, a `(hook)` row of chapter hooks, and an `(outcomes)` row of scene outcomes. It is a markdown table by default and CSV with `--format csv`; `--from` and `--to` narrow a wide book to a range of chapters. It raises no findings of its own.

Read it for shape rather than errors:

- **An empty row** is an arc in `plot/arcs/` that no chapter advances: a thread you planned and dropped, or one still to start.
- **A long gap in a row** is an arc the reader may forget. Touch it, or decide it rests on purpose.
- **A column with no `x`** is a chapter that moves no arc. Check that it earns its place, or list the arc it does advance.
- **An `(unknown)` row** is an id in `arcs-advanced` with no arc file; `story validate` reports it as an error. Add the arc with `story add arc` or fix the id.
- **The `(beat)` row** lays the beat sheet over the book. Check that each beat falls near its place in the structure (a `Midpoint` near the middle chapter) and that the arcs it turns have an `x` in that column.

The full option list is in the [CLI reference](cli-reference.md#grid). [`story diagram arcs`](#story-diagram) draws the same links as a Mermaid graph, and [`story pacing`](#story-pacing) checks the hooks and outcomes the grid lists.

## Books not in English

`story prose`, `story voices`, and `story names` use word lists: filter words, said-bookisms, `-ly` adverbs, speech verbs, contractions, stopwords, and the titles stripped from a name. These come from a language pack chosen by `language` in `story.md` (see [Publishing metadata](project-format.md#publishing-metadata)). `fr-CA` uses a French-Canadian pack if there is one, then a French pack, then a generic base pack with no word lists. The tag is read the same way on every system: `eng` is English, `iw` is Hebrew, `zh-yue` (Cantonese) uses the Chinese pack, and `en-GB-oed` the English one. A book with no `language` uses English. A `language` that is set but not a valid tag (`fr_FR`) is still not English: its first subtag picks the pack (French here), or the base pack when that is not a language either, and `story validate` reports it. `story import --language` sets the language for an imported manuscript.

English, Spanish (`es`), French (`fr`), and German (`de`) have word lists, and a regional tag (`es-MX`, `fr-CA`, `de-CH`) uses its language's. Each list follows its language: Spanish and French verbs in the past tenses fiction narrates in (`sintió`, `sentit`), said-bookisms such as `exclamó`, `s'exclama`, and `knurrte`, and the import headings `Capítulo`, `Chapitre`, and `Kapitel`, with their prologues and spelled-out numbers (`Capítulo veintiuno`, `Chapitre vingt et un`, `Kapitel Einundzwanzig`). Where English's checks do not carry over, the pack leaves the list out, and the check is skipped:

- **Adverbs.** Spanish counts `-mente adverbs` and French `-ment adverbs` (`lentement`, `vraiment`, `constamment`), leaving out nouns and verbs with the same ending (`moment`, `mouvement`, `aiment`), and any such word after an article, a possessive, a subject pronoun, or an elision (`le paiement`, `ils aiment`, `l'appartement`, `la mente`). German has no adverb ending, so its adverb check is skipped.
- **Dialogue tags.** French inverted tags count as their verb: `dit-il` is `dit`, and `demanda-t-elle` attributes speech in `story voices` as `she asked` does. A French tag inside the speech (`« Viens, dit-il, nous partons. »`, `— Viens, dit Paul en souriant, nous partons.`) or after `?` or `!` in dash dialogue (`— Viens ! s'exclama-t-il.`) is a tag too, and the speech on either side of it is speech.
- **Contractions.** Only English and German count them (German `geht's`, `auf'm`). Spanish `al` and `del` and French elision (`l'homme`, `j'ai`) are compulsory, so they say nothing about a voice, and the count is skipped.
- **Dialect.** The `british` and `american` spelling pairs are English; in another language a `dialect` other than `unspecified` is skipped. Record a variant's spellings as `preferred` entries.
- **Import names.** German capitalises every noun, so a capitalised word that follows an article or possessive in a third or more of its uses (`die Tür`, `der alte Hund`, `etwas Neues`), or that ends like a noun (`-ung`, `-heit`, `-keit`) and follows one at least once, is not offered as a name, and nor are common nouns that go without an article (`Angst`, `Wasser`, `mit Kindern`). A word after a title or next to a speech verb (`Herr Jung`, `sagte Gretchen`) is always a name, even when spoken German puts an article before it (`der Peter`), and `die` after a comma starts a relative clause (`die Frau, die Lena kannte`).
- **Ordinals.** In German a full stop after a number marks an ordinal, so `am 3. Mai` does not end a sentence. Headings may put the ordinal first (`Erstes Kapitel`, `1. Kapitel`, `Zweiter Teil`, `Première partie`, `Primera parte`), Spanish headings may drop their accents (`Capitulo 7`), and French reads the Belgian and Swiss `septante`, `huitante`, and `nonante`.
- **Abbreviations.** Each language keeps its own (`EE. UU.`, `p. m.`, `av. J.-C.`, `bzw.`, `sog.`), and in Spanish, French, and German any capital letter is an initial (`É. Zola`), unless it stands alone before a word that is never a name (`el plan B. Nadie`).

`style-sheet.md` can add to or replace any list, or supply the lists for a language with no pack, with `add-words` and `replace-words` (see [Word lists](project-format.md#word-lists)). `story prose`, `story voices`, `story names`, and `story import` (into an existing project) all read them.

In a book in any other language, a check that needs a list the pack lacks is skipped, never run with English words, so an Italian manuscript gets no English false positives. Each skipped check prints a note under the report heading, and its per-chapter line is left out:

```text
$ story prose
Prose report: 1 chapter, 1489 words
Note: Filter words skipped: no filterWords list for language it
Note: Adverbs skipped: no adverbSuffixes or adverbExceptions list for language it
Note: Dialogue tags skipped: no plainTags, saidBookisms, or beatPronouns list for language it
Note: Echoes skipped: no echoStopwords list for language it
Note: Repeated phrases skipped: no phraseStopwords list for language it
```

Sentence counts, the style sheet's watch words and `preferred` spellings, the baseline's sentence, paragraph, and dialogue measures, and similar names still run. A `british` or `american` `dialect` is skipped too. A baseline leaves out the filter-word and adverb rates and the signature words. In `story voices`, speech tags, contraction counts, and signature words are skipped: lines are attributed by action beats alone, and characters are compared on sentence length, questions, and exclamations. `story names` compares a name from its first word, since no titles are known. `--json` lists the skipped checks in `data.skipped`. Skipping never changes the exit code.

### Sorting, casing, and numbers

Lists shown to you follow the book's language too: the pronunciation guide in a narration build, unnumbered books in `story series` (when every book shares a language; `sv-SE` and `sv-FI` count as one), the word lists in `story prose` and `story voices`, and the entity candidates from `story import`. Swedish puts `Åsa` and `Örjan` after `Zorn`, German files `Äpfel` with `Apfel`, and Turkish puts `çay` after `cuma`. Words are lower-cased in the language before they are compared, so a Turkish `IŞIK` and `ışık` are the same word, and a Fountain build capitalises names and places in it (`İSKELE`, not `ISKELE`). Watch words, `preferred` spellings, and a character's `voice-words` and `voice-avoid` follow Turkish and Azerbaijani casing in a book in those languages, so a Turkish watch word `ılık` counts `ILIK`, and `ince` counts `İnce` but not `ınce`; other languages match them as JavaScript's case-insensitive regular expressions do. Ids (such as the POV ids in `story timeline`), file names, and chapter numbers sort the same in every language, and names the collator ranks equal are ordered by code point, so a report never depends on the order files were read. The Shunn manuscript's word count is written as the language writes numbers (`Approximately 12.300 words` in German), always with the digits 0 to 9; author-facing CLI reports keep `12,300`.

### Sentences and dialogue in other languages

Sentence splitting (sentence counts and lengths, the synopsis) and dialogue finding (`story voices`, and the narration `story prose` counts) follow the book's language pack too, and these need no word lists, so they work in every language:

- **Sentence ends.** `.`, `?`, `!`, and `…` before a space; the full-width `。`, `！`, and `？`, which need no space after them; the Arabic `؟`, the Urdu `۔`, the Devanagari danda `।` and `॥`, and the Ethiopic `።`. Spanish `¿` and `¡` open a sentence. The next sentence must start with a capital, a digit, an opening quote, or a letter of a script without case (Arabic, Hebrew, Devanagari, Chinese, Japanese), so `"Why?" she asked` stays one sentence. A dialogue dash before a capital opens the next sentence too (`—Vete. —Ella se giró.` and `– Hej, sa Anna. – Kom hit.` are two), while a tag after the dash stays in the sentence (`—¿Vienes? —preguntó ella.`), and so does a dash after an abbreviation such as `etc.`. A letter without case after the dash never opens one, in any language. In a language whose script has no case (Arabic, Hebrew, Hindi, Chinese, Japanese, Korean, Thai), any letter starts one; a dash after the stop still keeps a tag in the sentence. A guillemet may be set off by a space, as French sets it: a closing one may follow the stop (`« Viens. »`), and an opening one may start the next sentence (`Il partit. « Quoi ? » demanda-t-il.` is two sentences). After a full-width stop, a mark that can also open a quote (`“`, which closes `„…“` but opens `“…”`) belongs to the sentence only when it closes a quote still open there, so `他走了。“等一下，”小明说。` is two sentences. A quote closed after a full-width stop stays in its sentence when the quotative `と` or `って` follows it before punctuation or a verb of saying or thinking, so `「はい。」と言った。` is one sentence, but `「はい。」とにかく帰ろう。` is two. A synopsis list item that already ends with one of these stops gets no full stop added. Thai marks no sentence ends, so a Thai paragraph counts as one sentence.
- **Quote marks.** Every language reads curly and straight quotes, guillemets pointing out (`« … »`, `‹ … ›`), low-high quotes (`„…“`, `„…”`, `‚…‘`), and corner brackets (`「…」`, `『…』`). Some marks mean different things in different languages, so a few packs replace that list: German reads `„…“`, `‚…‘`, `»…«`, and `›…‹` (where `»` opens), Danish `»…«`, `›…‹`, `„…“`, and `”…”`, Swiss German `«…»`, `‹…›`, and `„…“`, Swedish and Finnish `”…”`, `’…’`, and `»…»` (one mark both opens and closes), and Japanese `「…」`, `『…』`, and `〝…〟`. Each of these also keeps straight `"…"` and curly `“…”` quotes. English reads only curly and straight quotes. Speech is trimmed, so `« Viens »` is `Viens`. A quote mark that can be an apostrophe (`’`, `'`) closes a quote only before a non-letter, so `don’t` never ends one.
- **Dialogue dash.** A paragraph that opens with an em dash (`—`, or the quotation dash `―`) is dialogue up to a closing dash (or, in English, a tag after a comma). Speech resumes after the tag when the next dash closes it: a dash against the tag's last word and not followed by a letter (`—Ya voy —dijo ella—. Espera.`: `Ya voy` and `Espera.` are speech, `dijo ella` narration), or a spaced dash right after the tag's punctuation (`— Привет, — сказал он. — Как дела?`). A dash between two words, or after narration that runs past the tag's sentence, is narration (`—Go home —he said. The sky darkened—rain was coming.`), and in English the tag must hold a speech verb, so `—and the house fell silent —or almost— until dawn.` has one line of speech. A dash after a finished sentence and before a capital is narration (`—Is it? —I asked.`, `—Vete. —Ella se giró.`), except in Swedish and Finnish, where it starts a new line of speech (`– Hej, sa Anna. – Kom hit.`). Swedish and Finnish also take an en dash (`– Hej, sa hon.`). Chinese and Japanese read no leading dash as dialogue.
- **Questions and exclamations** in `story voices` count `?`, `？`, and `؟`, and `!` and `！`.
- **Names** in Chinese, Japanese, Thai, Lao, Khmer, and Burmese, which put no spaces between words, are found inside the text around them (`「行こう」とミナは言った。` is Mina's), at the word boundaries `story wordcount` uses, so a name never matches the start of a longer name. `voice-words` and `voice-avoid` phrases, and the style sheet's `watch-words` and `preferred` spellings in `story prose`, match the same way: a Chinese or Japanese word at any character, a Thai one only where the dictionary splits words, so `แม` is not counted inside `แมว`.

## Story prose

```shell
story prose .
```

`story prose` is an advisory prose lint. It counts; it never scores or rewrites. It reads only chapter prose: the text after `## Chapter Text` (or, failing that, after the outline and its `---` divider), without headings, HTML comments, `` ``` `` fence lines, or scene-break rules; the code between fences counts, as in word counts. A removed comment leaves a space, so the words on either side stay separate: `really<!--x-->quiet` is two words here, though word counts and builds join it into one. Quoted dialogue (straight `"..."`, curly `“...”`, or British `‘...’`, or the [book's language's own marks](#sentences-and-dialogue-in-other-languages), paired the same way as in [`story voices`](#story-voices)) is removed before the filter-word and adverb counts, so a character's own words are not held against the narration. A heading line (one to six `#` and a space, or nothing after them) is dropped on its own, so prose that follows a heading without a blank line still counts, and a line of prose that opens with `#`, such as `#1 on the list was Mara`, is analysed like any other.

From [`examples/the-last-ember`](../examples/the-last-ember/), which has a style sheet:

```text
$ story prose examples/the-last-ember
Prose report: 1 chapter, 993 words

chapters/chapter-01.md: The Ember Wakes (993 words)
  Sentences: 134, average 7.4 words, longest 28, spread 6.3
  Filter words: 7.0 per 1k narration words (felt 2, knew 2, saw 1)
  -ly adverbs: 9.8 per 1k narration words (barely 1, faintly 1, immediately 1, mechanically 1, sharply 1)
  Dialogue tags: said 4; said-bookisms: none
  Echoes within 30 words: jumpy 2, almost 1, amber 1, beneath 1, dimmer 1
  Watch words: almost 3, something 5

Manuscript:
  Repeated 4-word phrases: "the plan is we" 3
  Similar character names: none
Prose check complete: 0 errors, 0 warnings, 0 dismissed
```

In a copy with three more lines of dialogue (using `hissed`, `snapped`, `growled`, `towards`, and `gray`) and a new character named Seren Hale, the changed report lines and the findings read:

```text
  Dialogue tags: said 4; said-bookisms: growled 1, hissed 1, snapped 1
  Spelling: towards 1 (use toward), gray 1 (use grey)
  ...
  Similar character names: Sera Voss / Seren Hale
Prose check complete: 0 errors, 4 warnings, 0 dismissed
warning: chapters/chapter-01.md uses "towards" once; style sheet prefers "toward" [prose-avoided-spelling]
warning: chapters/chapter-01.md uses "gray" once; british dialect prefers "grey" [prose-avoided-spelling]
warning: chapters/chapter-01.md has 3 said-bookism dialogue tags: growled 1, hissed 1, snapped 1 [prose-bookisms]
warning: characters sera-voss and seren-hale have similar first names (Sera Voss / Seren Hale) [prose-similar-names]
```

### What each line measures

| Line | Measures | Becomes a warning when |
|------|----------|------------------------|
| Sentences | Sentence count, mean length, longest, and spread (standard deviation of sentence length, in words). Titles and initials (`Mr.`, `Dr.`, `J. R.`, `U.S.`) and stammers (`I… I`) do not end a sentence. A capital alone does before a word that is never a name, from `candidate-stopwords` (`So do I. She left.`, `plan B. Nobody agreed.`), unless an article or particle from `title-words` starts a name with it (`Ursula K. Le Guin`) | 20 or more sentences with a spread under 5: `sentence lengths are uniform ...; vary the rhythm` |
| Filter words | `felt`, `saw`, `heard`, `noticed`, `realized`, `realised`, `wondered`, `seemed`, `watched`, `knew`, `decided`, `thought`, `sensed` in narration, per 1,000 narration words | Over 10 per 1,000, once the chapter has at least 300 narration words |
| -ly adverbs | Words over four letters ending in `-ly`, minus a built-in list of non-adverbs (`family`, `early`, `only`, ...) and the words of every name and alias in the bible (characters, locations, factions, artifacts, systems, glossary terms), also in the possessive, per 1,000 narration words | Over 12 per 1,000, once the chapter has at least 300 narration words |
| Dialogue tags | The first of `said`, `asked`, `says`, `asks`, or a said-bookism within three words after a closing quote, including a single quote that closes a single-quoted line. A quote ending in a full stop is followed by an action beat, not a tag (`"We leave at dawn." She smiled.`), and after `?` or `!` a capitalised word starts a beat unless it is a name before a plain tag (`"Now?" Mara asked.`) | 3 or more said-bookisms in a chapter |
| Echoes | Words of five or more letters repeated within 30 words, excluding common words, names from the bible (also possessive), and numbers | Never; the counts are for rereading |
| Watch words | Each `watch-words` entry from the style sheet | Never; the counts are for rereading |
| Spelling | Uses of each `avoid` spelling from the style sheet or the chosen dialect | Always, one warning per spelling per chapter |
| Repeated 4-word phrases | The ten most frequent four-word phrases used three or more times across the manuscript, ignoring phrases made only of common words | Never |
| Similar character names | First names (the first word that is not a title, so `Captain Mara Dole` is Mara) of three or more letters that are identical, share their first three letters, or are one edit apart (two edits when both names have five or more letters) | Always: `characters <a> and <b> have similar first names` |

The said-bookism list includes tags such as `barked`, `growled`, `hissed`, `laughed`, `smiled`, `snapped`, and `sighed`. `whispered`, `muttered`, and `shouted` are left out on purpose, because they describe volume, which `said` cannot.

The filter-word, adverb, and said-bookism limits are defaults: `--max-filter-words`, `--max-adverbs`, and `--max-bookisms` change them for a run, and `cli-defaults` in `story.md` changes them for the book (see [CLI defaults and severity](project-format.md#cli-defaults-and-severity)).

### Against your own prose

Fixed limits flag a writer whose style is deliberately adverb-heavy or long-sentenced, and they miss a chapter that has drifted from that writer's own voice. List some of your own prose as `samples` in the style sheet, such as an earlier book, or chapters of this one you are happy with, each named on its own:

```yaml
# style-sheet.md
samples:
  - ../book-one
  - chapters/chapter-01.md
```

A chapter listed as a sample is part of the profile, so it is not compared with it. Naming `chapters/` as a whole warns `style-sample-own-chapters`, since every chapter would be compared with itself. Each file counts once: an entry that names the same file as an earlier one (`./chapters/chapter-01.md` after `chapters/chapter-01.md`) warns `style-sample-duplicate`.

`story prose` then builds a profile from the samples. It covers sentence length and spread, paragraph length, the share of words in dialogue, filter-word and adverb rates, and the 20 content words you use most. The report prints the profile above the chapters. A chapter that drifts too far from it, either way, warns: `chapters/chapter-07.md sentences average 14.2 words, longer than your samples' 9.8 (tolerance 30%) [prose-baseline-sentences]`. With samples, your own filter-word and adverb rates replace the fixed limits.

The profile needs 2,000 words of sample narration. The tolerances are fixed and listed in [`prose`](cli-reference.md#comparing-with-your-own-prose), so the same samples and chapter always give the same result. A drift is a prompt to reread, not a verdict: a chase should run shorter than the book's average, and a quiet chapter longer. `--baseline=false` turns the comparison off for a run.

Prose findings are warnings. `story prose` exits 0 on any readable project, so you can run it freely, unless a `severity` entry in `story.md` promotes a prose warning, such as `prose-avoided-spelling`, to an error. The word lists are English; a book in another language skips the checks that need them (see [Books not in English](#books-not-in-english)).

To check a passage before it goes into a chapter file, pipe it in with `-` in place of the path: `story prose - < draft-scene.md`. The passage is linted with the same rules and the style sheet of the project in the current directory (or `--path`), and its findings are labelled `stdin`. See [Reading from stdin](cli-reference.md#reading-from-stdin).

### The style sheet

`story prose` reads the optional `style-sheet.md` at the project root. Without one, it prints `No style-sheet.md: spelling and watch-word checks are off`. The `voice-style` skill creates and maintains it; see [Writing workflows](writing-workflows.md#voice-and-house-style).

```yaml
# style-sheet.md
type: style-sheet
dialect: british
preferred:
  - use: toward
    avoid: towards
  - use: ember-stone
    avoid: emberstone
watch-words:
  - almost
  - something
allow-words:
  - quietly
```

| Field | Effect |
|-------|--------|
| `dialect` | `british` or `american` flags the other dialect's common spellings (`colour`/`color`, `grey`/`gray`, `towards`/`toward`, `travelled`/`traveled`, and so on). `-ise`/`-ize` is not included; record your choice as a `preferred` entry. `unspecified` turns the dialect check off. |
| `preferred` | Each `use`/`avoid` pair flags the `avoid` form. A `preferred` entry that names either spelling of a built-in dialect pair replaces that pair, so the word is not flagged twice. |
| `watch-words` | Counted in every chapter, as a reminder of your own tics. |
| `allow-words` | Silences a word as a filter word, said-bookism, adverb, or echo. Naming either spelling of a built-in dialect pair turns that pair off. |

Matches are case-insensitive whole words, with Turkish and Azerbaijani casing in a book in those languages (Turkish `ILIK` is a use of `ılık`), so `grey-haired` still counts as a use of `grey`, and a straight apostrophe in the style sheet also matches a curly one in the manuscript (`don't` counts `don’t`). An accented letter typed as one character matches the same letter typed with a combining mark (`café` counts `cafe` + U+0301), and the other way round. A capitalised word that is part of a name in the bible (`Dorian Gray`, `Center Point`) is not counted as an avoided spelling, and a `preferred` entry whose `use` and `avoid` are the same word is skipped. `story validate` checks the style sheet's shape: `type: style-sheet`, a known `dialect`, and a non-empty, different `use` and `avoid` in each `preferred` entry.

### Acting on the report

Treat the counts as a list of places to reread, not a list of errors. Filter words and adverbs above the threshold usually mark a passage told at a distance; said-bookisms usually mean the action should be its own beat. A repeated phrase across the manuscript is often a tic. An avoided spelling is a copyedit fix. Similar names are cheapest to fix before the draft is finished, and [`story names`](#story-names) catches them before a name is used at all. The [`line-editing`](../skills/line-editing/SKILL.md) skill uses this report for its line-edit and copyedit passes.

## Story voices

```shell
story voices .
```

`story voices` fingerprints each character's dialogue from the chapter prose, so you can see whether characters sound different from each other and from how you described them. It is advisory: every finding is a warning, and it exits 0 on any readable project. Its speech verbs, contractions, and stopwords are English; see [Books not in English](#books-not-in-english) for other languages.

`story voices - < draft-scene.md` checks the dialogue in a piped passage instead, against the characters of the project in the current directory (or `--path`). See [Reading from stdin](cli-reference.md#reading-from-stdin).

### How lines are attributed

It never guesses who is speaking. A paragraph's quoted lines (straight `"..."` or `'...'`, curly `“...”`, British `‘...’`, or a paragraph that opens with a dash, `— Line, said Cy.`) go to a character only when the narration around them says who spoke. In a book not in English, the quote marks and dialogue dash are the language's own (`« … »`, `„…“`, `»…«`, `「…」`); see [Sentences and dialogue in other languages](#sentences-and-dialogue-in-other-languages).

1. A speech tag: the character's name next to a speech verb such as `said`, `asked`, `replied`, `whispered`, `muttered`, `called`, `snapped`, or `went on`. A name before the verb wins over one after it, so in `"...," Sera told Kael` the line is Sera's, and `said Kael` gives it to Kael.
2. Failing that, an action beat: narration that names exactly one character (`Kael shouldered his pack. "For the record..."`).

Anything else is counted as unattributed. A character is matched by their full `name`, their given name (the first word that is not a title, so `Lord Maren` also matches `Maren`), and their `aliases`, case-sensitively. Pronoun tags (`she said`, `said he`, with `he`, `she`, `they`, `I`, or `we`) are never attributed, and a paragraph with one is left unattributed rather than credited to a character it merely names (`'It's nothing,' she said, holding it the way Tam used to`), so in close third person the POV character is often under-counted. A pronoun and speech verb count as a tag only right after a closing quote or right before an opening one (within about 40 characters); elsewhere in the paragraph they are narration, so `Mara set the ledger down. She said nothing more, and then: "We should go."` is still Mara's action beat. Characters with `status: cut` are ignored. Speech that runs over several paragraphs (an open quote at the paragraph end, reopened at the next paragraph start) goes to the speaker of the paragraph that attributes it, or counts as unattributed. Code between closed fences is ignored.

### What it prints

From [`examples/the-last-ember`](../examples/the-last-ember/):

```text
$ story voices examples/the-last-ember
Voices: 1 speaking character, 35 unattributed lines

kael-voss: 9 lines, 76 words
  Sentence length 5.1, contractions 6.6 per 100 words, questions 7%, exclamations 0%
  Signature words: jumpy, good, looking, sera, soldiers
Voice check complete: 0 errors, 0 warnings, 0 dismissed
```

Sera speaks most of the chapter's dialogue, but her lines are tagged only with pronouns (`she said`, `she murmured`) or not at all, so none of it is attributed. Each profile, largest first, shows:

- **Lines and words** of attributed dialogue.
- **Sentence length**: mean words per spoken sentence.
- **Contractions** per 100 words spoken (`don't`, `we're`, `I'd`, and `'s` after words where it cannot be a possessive: `it's`, `that's`, `let's`, `he's`, `where's`, ...).
- **Questions** and **exclamations**: the share of spoken sentences ending in `?` or `!`.
- **Signature words**: up to five words of four or more letters that the character says at least twice and more than twice as often, per word spoken, as everyone else combined. Common words are left out. `none yet` means nothing stands out.

Two optional character fields record the voice you intend:

```yaml
# characters/kael-voss.md
voice-words:
  - for the record
  - aye
voice-avoid:
  - good
```

`voice-words` are words and phrases the character does say; `voice-avoid` are ones they would never say. Both are lists of strings, matched as whole words or phrases, case-insensitively (with Turkish and Azerbaijani casing in a book in those languages), with either straight or curly apostrophes, and with an accented letter matching it typed either as one character or with a combining mark. The [`voice-style`](../skills/voice-style/SKILL.md) skill records them.

### Voice findings

In a copy of the last ember with those fields on Kael, and Sera's four pronoun tags (three `she said`, one `she murmured`) changed to `Sera said` or `Sera murmured`, which gives her six attributed lines:

```text
$ story voices .
Voices: 2 speaking characters, 29 unattributed lines

kael-voss: 9 lines, 76 words
  Sentence length 5.1, contractions 6.6 per 100 words, questions 7%, exclamations 0%
  Signature words: jumpy, good, looking, sera, soldiers

sera-voss: 6 lines, 28 words
  Sentence length 4.7, contractions 0.0 per 100 words, questions 0%, exclamations 0%
  Signature words: none yet
Voice check complete: 0 errors, 2 warnings, 0 dismissed
warning: kael-voss says "good", which is in their voice-avoid list (chapter-01) [voice-avoid]
warning: kael-voss does not say "aye" from their voice-words list in 9 attributed lines of dialogue [voice-words-unused]
```

| Message | Appears when | Fix |
|---------|--------------|-----|
| `<id> says "<phrase>", which is in their voice-avoid list (<chapters>)` | Any attributed line contains the phrase. The chapters that use it are listed. | Rewrite the line, or remove the phrase from `voice-avoid` if the character has changed. |
| `<id> does not say "<phrase>" from their voice-words list in <n> attributed lines of dialogue` | The character has five or more attributed lines and none uses the phrase. | Work the phrase in where it fits, or drop it from `voice-words`. |
| `<a> and <b> may sound alike: similar sentence length, contractions, questions, and exclamations` | Both have five or more lines, and all four measures are close: sentence length within 1.5 words, contractions within 1.5 per 100 words, and question and exclamation shares each within 10 points (each difference strictly less than its limit). | Separate them on more than one axis: sentence length, contractions, vocabulary, what they ask about. Here Kael and Sera are not flagged, because their contraction rates differ by 6.6. |

A low line count may mean few named tags rather than few lines. When a result matters, name the tags in a sample chapter and rerun.

## Story names

```shell
story names "Ilse Varn" "Teodor" --path .
```

`story names` checks candidate names before they go into the bible. It compares each one against every name already in use: character names, given names, and aliases (skipping `status: cut` characters), and the names of locations, factions, artifacts, systems, and glossary terms with their aliases. Pass one or more names, quoting any with spaces. It needs at least one name, and prints `Usage: story names <name...> [--path <project>]` otherwise.

From a copy of [`examples/harbor-of-second-light`](../examples/harbor-of-second-light/), whose cast is Mara Quill (protagonist), Theo Quill, and Councillor Ilya Venn (antagonist):

```text
$ story names "Mara" "Marra Quinn" "Ilse Varn" "Teodor" "Ivo" "Wren Calder" --path .
Mara: taken
Marra Quinn: check
Ilse Varn: check
Teodor: clear
Ivo: check
Wren Calder: clear
Name check failed: 1 errors, 3 warnings, 0 dismissed
error: "Mara" clashes with character mara-quill (Mara)
warning: "Marra Quinn" looks like character mara-quill (Mara Quill) [name-look-alike]
warning: "Ilse Varn" shares an initial with antagonist ilya-venn (Councillor Ilya Venn) [name-shared-initial]
warning: "Ivo" shares an initial with antagonist ilya-venn (Councillor Ilya Venn) [name-shared-initial]
```

Each candidate gets one verdict on stdout: `taken` (an error), `check` (a warning), or `clear`. Names are compared ignoring case, accents, and punctuation.

| Severity | Message | Appears when |
|----------|---------|--------------|
| error | `"<name>" clashes with <kind> <id> (<existing>)` | The candidate matches an existing name or alias exactly, or its given name matches a character's given name. `"Port Kestrel"` clashes with the location of that name. |
| warning | `"<name>" looks like <kind> <id> (<existing>)` | The given names (for characters) or single-word names look alike: both three letters or more, and they share their first four letters, or share a first letter and are one edit apart (two edits when both have five letters or more). Multi-word place and term names are only compared exactly. |
| warning | `"<name>" shares an initial with <role> <id> (<existing>)` | The candidate's given name starts with the same letter as a `protagonist`, `antagonist`, `deuteragonist`, or `narrator`, and does not already look like it. Readers skim names by their first letter. |

The command exits 1 when any candidate clashes, and 0 when there are only warnings. Titles and articles (`Lord`, `Captain`, `The`, and so on) are skipped when finding a given name, so `Captain Mara Dole` clashes with Mara Quill. A Chinese, Japanese, or Thai name written without spaces is compared whole, so `大` does not clash with `大島源治`; a space or an interpunct (`大島 源治`, `ジョン・スミス`) gives it a given name. It checks only the current project; for a series, run it in each book. The [`character-management`](../skills/character-management/SKILL.md) and [`worldbuilding`](../skills/worldbuilding/SKILL.md) skills run it before settling a name, and [`story prose`](#story-prose) catches similar first names among characters already in the bible.

## Story mentions

```shell
story mentions character edran-vale --path .
story mentions --path .
```

`story mentions <kind> <id>` lists every place a drafted chapter's prose names one character, location, faction, artifact, system, or glossary term, with its file, line, and column, and says which chapters name it without listing it in their frontmatter, or list it without naming it. Run it before `story remove`, which changes ids but never prose, and before `story rename`, which changes prose only with `--prose`.

It looks for the entity's `name`, its `aliases`, a character's given name, and each of these without leading titles or articles (`Hollow` for `The Hollow`; the titles come from the language pack). A given name of one letter of a script with capital letters is an initial and is not looked for alone, so `J. R. Dunn` is not found in "the letter J"; one Hangul syllable or Chinese character (`김` of `김 민준`) is still a given name. Only chapter prose is read: outline chapters, the outline, HTML comments, and code fences are skipped, and a name never runs across a blank line, a comment, or a fence. Names match as written and as whole words: a character called Rose is not found in "a rose", and a place called Bath is not found in "Bathsheba", but `Maren's` and `Vale-born` count. Only the first letter of a name of two or more words may differ in case. Where two names overlap, the longest wins, so `Edran Vale` is not also a mention of a place called Vale. Chinese and Japanese names match inside a run of characters, and Thai names at the segmenter's word breaks. An accented or voiced letter may be typed as one character or as a letter and a combining mark (`é` or `e` + U+0301, `が` or `か` + U+3099, as macOS file names and some input methods write them); both forms match each other, and lines, columns, and excerpts are those of the file as written.

`story continuity` runs half of this on every drafted chapter: it warns `named-not-listed` when the prose names a character that `pov`, `characters`, and `mentions` all leave out (see [Casts and locations](#casts-and-locations)). To keep it quiet on ordinary prose:

- Only characters are checked. A place is often named without being where the chapter happens, and an artifact has no list for being on the page.
- A one-word name that opens a sentence is not counted when the chapter also uses it as an ordinary word, so "Rose from her chair" in a chapter that has "a rose" in it is not a mention of Rose.
- A name two characters share is not counted, since it does not say which one is meant.
- Outline chapters and `status: cut` characters are not checked.

With no kind and id, `story mentions` runs the same check and adds `mention-not-named`: a character or artifact in a chapter's `mentions` that its prose never names. This one is not part of `continuity`, because a chapter often refers to someone only by relationship ("her father", "Grandmother"). When the warning is right, the mention is stale; when the chapter uses a name the bible lacks, add it to the entity's `aliases`. From [`examples/the-left-luggage-office`](../examples/the-left-luggage-office/):

```text
$ story mentions --path .
Mentions checked: 0 errors, 3 warnings, 0 dismissed
warning: chapters/chapter-02.md lists character folake-achebe in mentions but never names it; add the name the chapter uses as an alias, or drop the mention [mention-not-named]
warning: chapters/chapter-02.md lists character raymond-sallis in mentions but never names it; add the name the chapter uses as an alias, or drop the mention [mention-not-named]
warning: chapters/chapter-03.md lists character folake-achebe in mentions but never names it; add the name the chapter uses as an alias, or drop the mention [mention-not-named]
```

Chapter 2 calls Folake "a woman in a green coat" and chapter 3 calls her "F.", so these chapters refer to people without naming them. Both codes can be exempted per chapter or turned off with a `story.md` `severity` entry.

## Story diagram

```shell
story diagram <kind> [--path <project>] [--out <file>]
```

`story diagram` prints [Mermaid](https://mermaid.js.org/) source generated from frontmatter. The output is text, so it diffs cleanly, renders on GitHub and in most markdown editors, and can be rebuilt at any time from the same fields the checks read.

| Kind | Draws | From |
|------|-------|------|
| `relationships` | A family tree and relationship map. Family links (`parent`, `sibling`, `spouse`, `cousin`, and so on) are solid lines, with an arrow from the elder side for `parent`, `grandparent`, `aunt`, and `uncle`; other relationships are dotted and labelled with their `type`. Characters dead at the end of the book have a dashed outline (class `deceased`), and characters who died and came back a thick one (class `revived`); deaths are read as the [death checks](#deaths-and-posthumous-appearances) read them, from `died-in`, `revived-in`, `status`, and [status progressions](#status-progressions), with every chapter counted. | Character `relationships`, `status`, `died-in`, `revived-in`, status `progressions` |
| `locations` | The route network, each place labelled with its `region`, each edge with its hours and `mode`. An arrow means both directions declare their own route; a plain line is a two-way route declared once. | Location `routes`, `region` |
| `timeline` | A Mermaid timeline of dated scenes and scene-less chapters, grouped by date, with `(told in chapter N)` on anything told out of order | The same chronology as [`story timeline`](#story-timeline) |
| `clues` | Chapters in order, with an arrow from each clue's plant chapter to its reveal. Red herrings are dotted; clues with no reveal point at a `not yet revealed` node. Dropped and abandoned clues, and clues with no known `planted` chapter, are left out. | Clue `planted`, `payoff`, `status`, `red-herring` |
| `arcs` | Each arc linked to the chapters that advance it | Chapter and scene `arcs-advanced` |

From [`examples/harbor-of-second-light`](../examples/harbor-of-second-light/):

```text
$ story diagram relationships --path examples/harbor-of-second-light
flowchart LR
  ilya_venn["Councillor Ilya Venn"]
  mara_quill["Mara Quill"]
  theo_quill["Theo Quill"]
  ilya_venn -.-|"adversary"| mara_quill
  ilya_venn -.-|"former-supervisor"| theo_quill
  mara_quill ===|"sibling"| theo_quill
  classDef deceased stroke-dasharray: 4 4,color:#888
  class theo_quill deceased
$ story diagram locations --path examples/harbor-of-second-light
flowchart LR
  bellwether_reef["Bellwether Reef<br/>Western Shoals"]
  port_kestrel["Port Kestrel<br/>Western Shoals"]
  port_kestrel ---|"0.5h dive skiff"| bellwether_reef
```

And the clue flow of [`examples/the-unraveled-thread`](../examples/the-unraveled-thread/), matching the [`story clues`](#story-clues) grid:

```text
$ story diagram clues --path examples/the-unraveled-thread
flowchart LR
  chapter_01["1. The Ledger in the Ash"]
  chapter_02["2. The Millpond"]
  chapter_03["3. The Dry Side of Mill Row"]
  chapter_04["4. The Lock Gate"]
  chapter_01 ~~~ chapter_02
  chapter_02 ~~~ chapter_03
  chapter_03 ~~~ chapter_04
  chapter_01 -->|"Edran's Margin Notes"| chapter_04
  chapter_03 -->|"The Burned Page"| chapter_04
  chapter_02 -.->|"The Constable's Silence (red herring)"| unrevealed(("not yet revealed"))
  classDef open stroke-dasharray: 4 4
  class unrevealed open
```

Node ids replace hyphens with underscores, because Mermaid cannot always parse hyphens next to arrows; the labels carry the readable names. An id that is a Mermaid keyword, such as `end`, `graph`, `subgraph`, `style`, `class`, or `click`, gets `_node` appended, so a location called `end` becomes `end_node`. In the timeline, colons in times and titles become `∶`, because Mermaid's timeline syntax splits on colons.

To paste a diagram into a markdown file, wrap it in a fenced block with the language `mermaid`. To save it instead, pass `--out`:

```text
$ story diagram timeline --out dist/timeline.mmd
Wrote timeline diagram to /home/you/books/the-unraveled-thread/dist/timeline.mmd
```

A relative `--out` path is resolved against the project root and must stay inside it; `dist/` keeps diagrams with the other disposable build output. Nothing is written if any project file fails to parse, because a diagram drawn from a partial scan would silently drop entities. A missing or unknown kind exits 2 with `Unknown diagram kind: <kind>. Supported kinds: relationships, locations, timeline, clues, arcs`.

## Story progress

```shell
story progress .
story progress . --log
story progress . --date 2026-09-24
```

`story progress` measures the manuscript word count (the same count as `story wordcount`) against targets set in frontmatter:

| Where | Field | Meaning |
|-------|-------|---------|
| `story.md` | `target-words` | Word target for the book (positive integer) |
| `story.md` | `deadline` | Due date, `YYYY-MM-DD` |
| `story.md` | `daily-target-words` | Words a writing day aims for (positive integer) |
| `story.md` | `writing-days` | The weekdays you plan to write, such as `[mon, tue, thu, fri]`; default every day |
| `story.md` | `release-every`, `release-start` | A serial's cadence: an episode every so many days, or months such as `1 month`, from the first release date |
| `story.md` | `release-warn-days` | How many days ahead to warn about an episode with no prose; default 3 |
| `chapters/chapter-NN.md` | `target-words` | Word target for the chapter (positive integer) |
| `chapters/chapter-NN.md` | `release-date` | The day this episode releases, off the cadence |
| `progress.md` | `sessions` | The log: a list of `date` and `words` entries |

From a copy of the last ember with `target-words: 90000` and `deadline: 2027-03-31` in `story.md`, `target-words: 3500` on chapter 1, and the four sessions in the `progress.md` shown below:

```text
$ story progress . --date 2026-09-24
Progress: 993 of 90,000 words (1.1%)
Remaining: 89,007 words
Deadline: 2027-03-31 (188 days left): 474 words a day needed
Sessions: 4 logged; last 2026-09-24 (+26 words since)
Pace: 85 words a day over the last 4 sessions
Projected finish at this pace: 2029-08-10
Today: +233 words
Streak: 1 day (longest 1)

Last 4 weeks:
- 2026-08-31: 0 words on 0 days
- 2026-09-07: 0 words on 0 days
- 2026-09-14: 640 words on 2 days
- 2026-09-21: 233 words on 1 day

Chapter targets:
- chapter-01: 993 of 3,500 words (28%)
Progress checked: 0 errors, 0 warnings, 0 dismissed
```

- **Deadline** shows the words a day needed to finish on time, `(today): <n> words needed` on the deadline day, or `passed <n> days ago`. Without `target-words`, it shows only the days left.
- **Sessions** shows the change in words since the last logged session.
- **Pace** is the words gained per calendar day across the last seven logged sessions. It needs at least two sessions on different days.
- **Projected finish** extends that pace from today to the target. It is omitted when the pace rounds to zero or is negative, when the finish would be more than 100 years away, or when the target is met.
- **Today** is the words gained since the last session logged before today, measured from the manuscript as it is now, so it counts words not yet logged. It is left out until a session before today exists. A day's words are always a gain against the session before it, because each session records the whole manuscript: the first session is only the starting point.
- **Streak** counts the days in a row that gained words, ending today or, while today has none yet, yesterday. With `daily-target-words`, a day must reach the target to count. Days outside `writing-days` never break the streak, and count when you write on them anyway. A day with no session counts as a day without writing, so log every writing day; a log that skips days credits their words to the next session.
- **Last 4 weeks** sums the words gained in each week, Monday to Sunday, ending with the current week, and the days that gained words. `--weeks <n>` shows 1 to 52 weeks instead (`This week:` for 1), and `cli-defaults` in `story.md` can set it for the book. With `daily-target-words`, each week shows its target too: the daily target times the writing days in that week.
- **Next release** shows the first serial episode due today or later, the days until it, and whether its chapter has prose yet, when the book has a [release schedule](project-format.md#release-schedule). An episode due within `release-warn-days` days (default 3), or past due, with no prose is a `release-undrafted` warning. Once `story.md` has `status: complete`, the schedule ends at the last chapter. When every chapter has a release date, it marks the final release as the last episode, and after it reports the story complete instead of more episodes to write.
- **Chapter targets** lists only chapters that set `target-words`.

Without `target-words`, the first line reads `Progress: <n> words (no target-words in story.md)`. Without sessions, the sessions line reads `Sessions: none logged (run story progress --log after a writing session)`. The unmodified example shows both:

```text
$ story progress examples/the-last-ember
Progress: 993 words (no target-words in story.md)
Sessions: none logged (run story progress --log after a writing session)
Progress checked: 0 errors, 0 warnings, 0 dismissed
```

Add `daily-target-words: 250` and `writing-days: [mon, wed, thu, fri]` to the same `story.md`, and the day after the last session measures today against the target:

```text
$ story progress . --date 2026-09-25
...
Today: +26 of 250 words (224 to go)
Streak: 0 days (longest 1; writing days mon, wed, thu, fri)

Last 4 weeks:
- 2026-08-31: 0 of 1,000 words on 0 days
- 2026-09-07: 0 of 1,000 words on 0 days
- 2026-09-14: 640 of 1,000 words on 2 days
- 2026-09-21: 233 of 1,000 words on 2 days
...
```

The 207 words logged on Thursday 2026-09-24 fell short of 250, so that day broke the streak. A book counted in characters sets `daily-target-characters` instead.

`--log` records today's total in `progress.md`, creating the file if needed (`type: progress-log`) and replacing any entry for the same date, then prints `Logged <n> words for <date> in <file>` before the report. It keeps the file body and any other frontmatter. It refuses to write if `progress.md` does not parse or has invalid sessions, since rewriting would drop them; run `story validate .` to see each problem. `--date YYYY-MM-DD` sets "today", for the log and the calculations. It defaults to your local date, and an impossible date is refused (`progress --date date must be a real YYYY-MM-DD calendar day, got 2026-02-30`).

```yaml
# progress.md
type: progress-log
sessions:
  - date: 2026-09-14
    words: 120
  - date: 2026-09-17
    words: 480
  - date: 2026-09-20
    words: 760
  - date: 2026-09-24
    words: 967
```

`words` is the manuscript total on that day, not the words written in the session. `story validate` checks each entry: a real date, no repeated dates, and a whole number of words that is zero or more.

Run `story progress . --log` at the end of each writing session. The [Automation and CI](automation.md) page shows how to run it on a schedule.

## Story compare

```shell
story compare . --ref draft-1
story compare . --against ../the-tide-room-draft-1
```

`story compare` measures how much a revision pass changed, chapter by chapter, against one earlier draft. Pass exactly one source:

| Option | Earlier draft |
|--------|---------------|
| `--ref <git-ref>` | A branch, tag, or commit (with `~` and `^` suffixes) in the git repository that contains the project. The project may be a subfolder of the repository. |
| `--against <path>` | Another copy of the project folder, such as a snapshot made before the pass |

With `--ref`, compare reads the `chapters/chapter-NN.md` files at that ref through `git show`. It never commits, tags, or changes the working tree. Old chapter files without frontmatter are compared by prose alone.

From a revised copy of the unraveled thread, with one paragraph added to chapter 1, one sentence rewritten in chapter 4, and a new outline chapter 5 (`story add chapter "The Constable's Visit" --number 5`), compared with an untouched copy beside it:

```text
$ story compare . --against ../draft-1
Compared with /home/you/books/draft-1
Chapters: 4 then, 5 now (1 added, 0 removed)
Words: 111 then, 143 now (+32)

- chapter-01 The Ledger in the Ash: 34 -> 59 words (+25), 50% of paragraphs unchanged
- chapter-02 The Millpond: unchanged (31 words)
- chapter-03 The Dry Side of Mill Row: unchanged (24 words)
- chapter-04 The Lock Gate: 22 -> 29 words (+7), 0% of paragraphs unchanged
- chapter-05 The Constable's Visit: added (0 words)
Comparison complete: 0 errors, 0 warnings, 0 dismissed
```

The first line names the source: the absolute path of the `--against` folder, or `git ref <ref>` with `--ref`. A removed chapter reads `removed (was <n> words)`.

How to read it:

- Chapters are matched by id (`chapter-04`), unless a chapter's paragraphs match a chapter under another id better. Then the two are paired and the line reads `chapter-03 The Millpond (moved from chapter-02): ...`, so chapters renumbered by `story move` show as moved rather than as rewritten, added, or removed. A pair under different ids needs at least half the paragraphs of the longer version to match word for word, so a renumbered chapter that was also heavily rewritten still shows as one removed and one added.
- **% of paragraphs unchanged** is the share of the current chapter's paragraphs that appear word for word in the earlier version, ignoring whitespace. A chapter with 0% has had every paragraph touched, even if only lightly.
- A chapter is `unchanged` only when its paragraphs are the same and in the same order. Scene-break lines are not counted as paragraphs.

To place a reader's note from an older [review copy](manuscripts.md#html-review-copy), add `--anchor <label>` (repeatable): `story compare . --ref beta-round-1 --anchor ch03-p12` prints where that paragraph is now instead of the chapter comparison. See [`compare`](cli-reference.md#mapping-review-copy-labels).

The [`revision-continuity`](../skills/revision-continuity/SKILL.md) skill takes a snapshot before any multi-chapter pass and runs `story compare` afterwards; see [Writing workflows](writing-workflows.md#revision-passes).

## Story similarity

```shell
story similarity . --against ../book-one
story similarity . --against sources/letters.txt --min-words 12
story similarity . --against draft-1
```

`story similarity` finds passages of chapter prose that share a run of words with other text: your earlier books, a previous draft, or a source you worked from. `--against` is a file, a folder, or a git ref. A folder with `story.md` is compared chapter by chapter; any other folder contributes all its `.md`, `.markdown`, and `.txt` files.

Words are compared lowercased with punctuation dropped. Each run of `--min-words` (default 8) or more shared words is one `similarity-shared-passage` warning. The warning gives the chapter's review-copy label, where the run is in the reference, and the shared words:

```text
warning: chapters/chapter-02.md (ch02-p1) shares 9 words with ../sources/parish-notes.txt (p2): "was pulled from the millpond on a grey Tuesday" [similarity-shared-passage]
```

The report above the warnings gives each chapter's shared words and share, and the total.

How to read it:

- **It is a place to look, not a verdict.** Stock phrases, a quotation you meant, or your own recurring line all share words. The command exits 0; promote the warning with `severity` only if you want a CI gate on it.
- **It only knows the text you gave it.** No shared passages means none with that text, not that the book is original.
- **Raise `--min-words` for long references.** Against a whole shelf of earlier books, eight-word runs can turn up ordinary phrasing. Set a higher default in `story.md` [`cli-defaults`](project-format.md#cli-defaults-and-severity) once you know what your books share.
- **Against a git ref it shows what survived a revision.** Every unchanged run is a passage, so use [`story compare`](#story-compare) for the size of a revision and `similarity` for the exact wording that stayed.

The [`editorial-review`](../skills/editorial-review/SKILL.md) skill runs it when you worry about a source and says how to report the result. See [`similarity`](cli-reference.md#similarity) for every option.

## Story passes

```shell
story passes .
story passes . --init
story passes . --start pacing
story passes . --done pacing
```

A full revision works best as a ladder of separate passes, each looking for one kind of problem, from the largest (structure) to the smallest (proof), so you do not polish sentences a structural change will cut. `story passes` keeps that ladder in the `revision-passes` list in `story.md`, so it survives between sessions.

Without any passes recorded, it prints the default ladder and the checks each pass runs:

```text
$ story passes .
Revision passes: none recorded. Run story passes --init to add the default ladder:

- structure: Order of events, act turns, scenes that do not change anything (story timeline, story pacing, story diagram arcs)
- character: Wants, arcs, motivation, and who knows what when (story voices, story knowledge <id> --at <chapter>, story diagram relationships)
- theme: Premise, counter-premise, motifs, and the lie/truth arc (story report)
- continuity: Deaths, props, travel, promises, clues, and backlinks (story continuity, story clues, story links)
- pacing: Scene outcomes, sequels, chapter hooks, and chapter lengths (story pacing)
- line: Sentence-level clarity, rhythm, and distinct voices (story prose, story voices)
- copyedit: Spelling, usage, and consistency against the style sheet (story prose)
- proof: Typos and layout in the built book (story build --format print, story build --format html)
```

| Option | Effect |
|--------|--------|
| `--init` | Adds each default pass that is not already listed, with `status: pending`, after any existing passes. Existing entries keep their status. |
| `--start <pass>` | Sets the pass to `in-progress`, adding it to the end of the list if it is new |
| `--done <pass>` | Sets the pass to `done`, adding it if it is new |

Any kebab-case name works as a pass, so you can add your own (`--start sensitivity-read`). A custom pass has no focus or checks listed. Adding one prints `note: Added custom pass <name>, which is not in the default ladder` to stderr, ending `; did you mean <pass>?` when the name is within two edits of a default pass, such as `charcter`. When the list changes, the command prints `Updated revision-passes in story.md` and rewrites only that frontmatter entry; the rest of `story.md` is kept. It then prints the checklist. From a copy of the unraveled thread after `--init`, `--done structure`, and `--start character`:

```text
$ story passes . --start character
Updated revision-passes in story.md
Revision passes: 1 of 8 done

[x] structure - Order of events, act turns, scenes that do not change anything (story timeline, story pacing, story diagram arcs)
[~] character - Wants, arcs, motivation, and who knows what when (story voices, story knowledge <id> --at <chapter>, story diagram relationships)
[ ] theme - Premise, counter-premise, motifs, and the lie/truth arc (story report)
[ ] continuity - Deaths, props, travel, promises, clues, and backlinks (story continuity, story clues, story links)
[ ] pacing - Scene outcomes, sequels, chapter hooks, and chapter lengths (story pacing)
[ ] line - Sentence-level clarity, rhythm, and distinct voices (story prose, story voices)
[ ] copyedit - Spelling, usage, and consistency against the style sheet (story prose)
[ ] proof - Typos and layout in the built book (story build --format print, story build --format html)

Next: character (in progress); mark it with story passes --done character
```

`[x]` is done, `[~]` in progress, and `[ ]` pending. The next pass is the first one in progress, or else the first one not done. When every pass is done, the last line reads `All passes done.` The file now holds:

```yaml
# story.md
revision-passes:
  - pass: structure
    status: done
  - pass: character
    status: in-progress
  - pass: theme
    status: pending
  # ...and so on to proof
```

`story passes` exits 0 unless it cannot write: a pass name that is not kebab-case exits 2 with `Revision pass names must be kebab-case, got <name>`, and a `revision-passes` list that `story validate` would reject exits 3 with `Fix revision-passes in story.md before changing it: ...`. `story validate` requires a list of objects, each with a kebab-case `pass` listed once and an optional `status` of `pending` (the default), `in-progress`, or `done`.

While `story.md` has `status: revising`, [`story next`](#story-next) turns the ladder into an action: `Plan revision passes` when none are recorded, then `Revision pass: <name>` with the pass's focus and checks, until every pass is done. The [`revision-continuity`](../skills/revision-continuity/SKILL.md) skill works through the passes one at a time.

## Report, next, and doctor

These three commands run `validate`, `links`, and `continuity` together and summarise the results. They exit 0 whatever the checks find (only a folder without `story.md` makes them fail, with exit code 3): use them to decide what to do, and use the individual checks in scripts and CI.

### story report

`story report` prints the project's metadata, an inventory of every entity kind, each chapter with status, word count, and POV, each arc, and one line per check. `--actionable` adds the next actions.

```text
$ story report examples/the-unraveled-thread --actionable
# The Unraveled Thread

Story ID: the-unraveled-thread
Schema version: 2
Status: drafting
Genre: mystery / village-noir
Form: novel
POV/Tense: third-person-limited / past

Inventory:
- Characters: 3
- Locations: 1
- Systems: 0
- Factions: 0
- Artifacts: 1
- Arcs: 1
- Chapters: 4
- Scenes: 4
- Questions: 1
- Promises: 2
- Clues: 3
- Glossary terms: 0
- Total words: 111

Chapters:
- 1. The Ledger in the Ash (draft, 34 words, POV: jonas-reed)
- 2. The Millpond (draft, 31 words, POV: jonas-reed)
- 3. The Dry Side of Mill Row (draft, 24 words, POV: nessa-thorn)
- 4. The Lock Gate (draft, 22 words, POV: jonas-reed)

Arcs:
- The Ledger Trail (main, planned, 0 characters)

Checks:
- Validate: ok (0 errors, 0 warnings)
- Links: ok (0 errors, 0 warnings)
- Continuity: failed (4 errors, 3 warnings)

Next Actions:
- [P0] Fix continuity contradictions: Run story continuity examples/the-unraveled-thread and repair 4 deterministic continuity errors.
- [P1] Review continuity warnings: Run story continuity examples/the-unraveled-thread and review 3 continuity warnings.
- [P2] Review promises and payoffs: 1 setup/payoff promise needs planting or a payoff decision.
- [P2] Review open clues: 1 clues are still planned or planted.
- [P2] Draft chapter 5: Use story add chapter "Chapter 5" --number 5 --path examples/the-unraveled-thread, then outline scenes to advance The Ledger Trail.
```

The report also shows `Series` when `story.md` sets one, `Form` when it sets a `form`, `Research notes` when there are any, and `Target words` with a percentage when `target-words` is set. The `Checks` lines cover `validate`, `links`, and `continuity` only; the advisory commands (`pacing`, `clues`, `prose`, `voices`) are not run, so run them yourself.

### story next

`story next` prints the check summary and the action list, and nothing else. It is the quickest way to start a writing session:

```text
$ story next examples/the-last-ember
# Next Writing Actions: The Last Ember

Checks: validate ok (0 errors, 0 warnings), links ok (0 errors, 0 warnings), continuity ok (0 errors, 0 warnings)

Actions:
- [P2] Draft chapter 2: Use story add chapter "Chapter 2" --number 2 --path examples/the-last-ember, then outline scenes to advance Sera's Reclamation.
- [P3] Project is mechanically healthy: No deterministic maintenance issues are blocking the next writing pass.
```

The last ember follows another book, so run this with its sibling [`the-fall-of-the-citadel`](../examples/the-fall-of-the-citadel/) beside it; a copy on its own reports a broken series link.

When `story.md` has `status: revising`, `story next` also names the current [revision pass](#story-passes). From the copy of the unraveled thread in [Story passes](#story-passes), with `character` in progress:

```text
$ story next .
# Next Writing Actions: The Unraveled Thread

Checks: validate ok (0 errors, 0 warnings), links ok (0 errors, 0 warnings), continuity failed (4 errors, 3 warnings)

Actions:
- [P0] Fix continuity contradictions: Run story continuity . and repair 4 deterministic continuity errors.
- [P1] Review continuity warnings: Run story continuity . and review 3 continuity warnings.
- [P1] Revision pass: character: Wants, arcs, motivation, and who knows what when. Run story voices, story knowledge <id> --at <chapter>, story diagram relationships. Mark it with story passes --done character.
- [P2] Review promises and payoffs: 1 setup/payoff promise needs planting or a payoff decision.
- [P2] Review open clues: 1 clues are still planned or planted.
```

A revising book gets no "Draft chapter" action. Before any passes are recorded, the same line reads `[P1] Plan revision passes: Run story passes --init to record the structure-to-proof pass ladder, then work one pass at a time.` A custom pass reads `Work through this pass.` with no checks. Once every pass is done, the line disappears.

### story doctor

`story doctor` prints the same actions with the project root and one line per check, for when something is broken:

```text
$ story doctor examples/the-unraveled-thread
# Story Doctor: The Unraveled Thread

Root: /home/you/story-skills/examples/the-unraveled-thread

Checks:
- Validate: ok (0 errors, 0 warnings)
- Links: ok (0 errors, 0 warnings)
- Continuity: failed (4 errors, 3 warnings)

Actions:
- [P0] Fix continuity contradictions: Run story continuity examples/the-unraveled-thread and repair 4 deterministic continuity errors.
- [P1] Review continuity warnings: Run story continuity examples/the-unraveled-thread and review 3 continuity warnings.
- [P2] Review promises and payoffs: 1 setup/payoff promise needs planting or a payoff decision.
- [P2] Review open clues: 1 clues are still planned or planted.
- [P2] Draft chapter 5: Use story add chapter "Chapter 5" --number 5 --path examples/the-unraveled-thread, then outline scenes to advance The Ledger Trail.
```

`story doctor --fix` first puts back a `split`, `merge`, `move`, `rename`, or `remove` that stopped part way (see [Interrupted changes](cli-reference.md#interrupted-changes)), then applies the mechanical repairs the checks call for (`migrate`, `wordcount --write`, and `reindex`), never touching prose, then prints this report for what remains and exits 1 while a check still has an error. `--dry-run` shows the repairs without making them. See [doctor](cli-reference.md#doctor) for which finding triggers which repair.

### Actions and priorities

All three commands build the same action list. It is sorted by priority, P0 first, and actions with the same priority appear in the order below.

| Priority | Action | Appears when |
|----------|--------|--------------|
| P0 | Fix validation errors | `story validate` has errors |
| P0 | Fix broken references | `story links` has errors |
| P0 | Fix continuity contradictions | `story continuity` has errors after exemptions |
| P1 | Review validation warnings | `story validate` has warnings other than stale word counts and missing scene records (which have their own actions below), such as open research a final chapter relies on or an empty matter page |
| P1 | Review continuity warnings | `story continuity` has warnings after exemptions |
| P1 | Refresh word counts | A chapter's `word-count` differs from its prose |
| P1 | Add scene records | A chapter has no scene files in `scenes/` |
| P1 | Reconcile discovered chapters | A chapter has `mode: discovered` (or, in a `draft-mode: discovered` project, no `mode` and some prose) and no `## Chapter Notes (post-hoc)` heading above `## Chapter Text`. The detail reads `Run the discovery-drafting reconcile loop and add ## Chapter Notes (post-hoc) for <ids>.` |
| P1 | Plan revision passes | `story.md` has `status: revising` and no `revision-passes` |
| P1 | Revision pass: `<name>` | `story.md` has `status: revising` and a pass that is not done. The check commands name the project path, like the rest of the list |
| P2 | Track open questions | A question has `status: open` |
| P2 | Review promises and payoffs | A promise is `planned` or `planted` |
| P2 | Review open clues | A clue is `planned` or `planted` |
| P2 | Draft chapter N | The chapter after the highest number, naming up to three unresolved arcs. Left out when `story.md` has `status: revising`, `status: complete`, or `status: abandoned`, or when every arc is `resolved` |
| P2 | Create first character | The project has no characters |
| P3 | Project is mechanically healthy | All three checks pass with no warnings, and no action above applies except drafting the next chapter or creating a first character |

Work down from P0. P0 and P1 items are mechanical and have a command to run. P2 items are writing decisions.

## When to run what

| Moment | Commands |
|--------|----------|
| Start of a session | `story next .` |
| Before naming a character, place, or term | `story names '<candidate>' --path .` |
| Before renaming or removing a character, place, or term | `story mentions <kind> <id> --path .` |
| After drafting or revising a chapter | `story reindex .`, `story wordcount . --write`, `story check .`, `story pacing .` |
| Before drafting a chapter or scene | `story context <chapter-or-scene-id> --path .` |
| Before writing a scene that turns on a secret | `story knowledge <id> --at <chapter-id>` |
| Planning structure or pacing | `story timeline .`, `story pacing .`, `story diagram arcs` |
| Inserting, reordering, splitting, or merging chapters and scenes | `story split <chapter-id> --at <marker>`, `story merge <chapter-id> <next-chapter-id>`, `story move chapter <id> --number <n>` (highest chapter first), `story move scene <id> --chapter <chapter-id>`, then `story reindex .`, `story wordcount . --write`, and `story check .` |
| Planting or revealing a mystery clue | `story clues .`, `story diagram clues` |
| Adding places and journeys | `story diagram locations`, then `story continuity .` for route travel |
| After dialogue changes | `story voices .` |
| Line edit or copyedit | `story prose .`, `story voices .` |
| Starting or finishing a revision pass | `story passes .`, `story passes . --done <pass>` |
| End of a session | `story progress . --log` |
| After a multi-chapter revision pass | `story compare . --ref <snapshot>` |
| Something is failing and you do not know why | `story doctor .` |

Books linked with `follows` or `precedes` also need `story series .`, which checks canon shared across books; see [Series](series.md). To run the checks on every push, see [Automation and CI](automation.md).

## See also

- [CLI reference](cli-reference.md): every command and flag
- [Project format reference](project-format.md): every frontmatter field these checks read
- [Writing workflows](writing-workflows.md): the revision passes that use these commands
- [Skills catalogue](skills.md): the `revision-continuity`, `line-editing`, `voice-style`, `scene-craft`, `genre-craft`, `worldbuilding`, and `story-maintenance` skills
- [Series](series.md): shared canon and `fact` ids across books
- [Documentation index](README.md): every page, by audience and task

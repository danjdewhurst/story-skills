# Continuity and analysis

This page is for writers and agents who want to know what the `story` CLI can check about a manuscript, and what to do when it finds something. It covers the continuity engine (deaths, casts, promises, questions, clues, state, prop custody, clock, and route travel), exemptions, and the analysis commands: `knowledge`, `timeline`, `pacing`, `clues`, `prose`, `voices`, `names`, `diagram`, `progress`, `compare`, `passes`, `report`, `next`, and `doctor`.

All of them are read-only except three:

- `story progress --log` adds or replaces today's entry in `progress.md`.
- `story passes` with `--init`, `--start`, or `--done` rewrites the `revision-passes` list in `story.md`.
- `story diagram --out` writes the diagram to a file.

All of these commands are deterministic. They read your markdown frontmatter and chapter prose, never call a model, never rewrite prose, and give the same answer every time for the same files. They only flag contradictions that the frontmatter makes visible. Judgement calls, such as whether a character acts on knowledge they have not learned yet, are left to you or to the [`revision-continuity`](../skills/revision-continuity/SKILL.md) skill.

For flags and exit codes of every command, see the [CLI reference](cli-reference.md). For the full field list of each file, see the [Project format reference](project-format.md).

**On this page**

- [At a glance](#at-a-glance)
- [Find your message](#find-your-message)
- [Story continuity](#story-continuity): [how findings are reported](#how-findings-are-reported), [deaths](#deaths-and-posthumous-appearances), [casts](#casts-and-locations), [promises, questions, and clues](#promises-questions-and-clues), [state](#continuity-state), [prop custody](#prop-custody), [clock](#clock-and-travel-time), [route travel](#route-travel), [worked example](#worked-example-fixing-the-unraveled-thread)
- [Exemptions](#exemptions)
- [Story knowledge](#story-knowledge)
- [Story timeline](#story-timeline)
- [Story pacing](#story-pacing)
- [Story clues](#story-clues)
- [Story prose](#story-prose)
- [Story voices](#story-voices)
- [Story names](#story-names)
- [Story diagram](#story-diagram)
- [Story progress](#story-progress)
- [Story compare](#story-compare)
- [Story passes](#story-passes)
- [Report, next, and doctor](#report-next-and-doctor)
- [When to run what](#when-to-run-what)

## At a glance

| Command | Answers |
|---------|---------|
| [`story continuity [path]`](#story-continuity) | Does the recorded story contradict itself? |
| [`story knowledge <id> --at <chapter-id>`](#story-knowledge) | What did this character know by this chapter? |
| [`story timeline [path]`](#story-timeline) | What order do events happen in story time? Whose book is it? Who disappears? |
| [`story pacing [path]`](#story-pacing) | Do scenes cost the characters enough, do chapters end with a pull, and are any chapters out of proportion? |
| [`story clues [path]`](#story-clues) | Where is each clue planted and revealed, and does the mystery play fair? |
| [`story prose [path]`](#story-prose) | Where does the prose lean on filter words, adverbs, said-bookisms, or off-sheet spellings? |
| [`story voices [path]`](#story-voices) | How does each character talk, and do any two sound alike? |
| [`story names <name...>`](#story-names) | Is this candidate name already taken, or too close to one in use? |
| [`story diagram <kind>`](#story-diagram) | What do the family tree, route map, timeline, clue flow, or arc map look like? |
| [`story progress [path]`](#story-progress) | How far along is the draft against its targets and deadline? |
| [`story compare [path]`](#story-compare) | How much did this revision pass change? |
| [`story passes [path]`](#story-passes) | Which revision pass am I on, and what should it check? |
| [`story report [path]`](#story-report) | What is in this project and do the checks pass? |
| [`story next [path]`](#story-next) | What should I do next? |
| [`story doctor [path]`](#story-doctor) | What is broken and how do I repair it? |

Most commands take the project as an optional positional path or `--path`. `knowledge`, `names`, and `diagram` take only `--path`, because their positional arguments are a character id, candidate names, and a diagram kind.

Only `continuity` and `names` fail because of what the story says: `continuity` on a contradiction, `names` on a candidate that is already taken. The others exit 1 only on bad arguments or files that do not parse. `pacing`, `clues`, `prose`, and `voices` findings are always warnings, and `report`, `next`, and `doctor` exit 0 whatever the checks find. For when each command exits 1, see [Output streams and exit codes](cli-reference.md#output-streams-and-exit-codes).

## Find your message

Every finding starts with a severity and, usually, a file path. Match the rest of the line against this table to jump to the explanation and fix.

| The finding contains | Command | Explained in |
|----------------------|---------|--------------|
| `lists <id>, who died in`, `has died-in`, `died-in references missing chapter` | `continuity` | [Deaths and posthumous appearances](#deaths-and-posthumous-appearances) |
| `POV character <id> is not listed in characters`, `does not list them in characters or mentions`, `does not list that location`, `Chapter numbering skips` | `continuity` | [Casts and locations](#casts-and-locations) |
| `pays off in … before it is planted`, `resolves in … before it is introduced`, `no payoff chapter`, `no planted chapter`, `no plant chapter`, `has no resolved chapter`, `status is still open`, `status is still planned` | `continuity` | [Promises, questions, and clues](#promises-questions-and-clues) |
| `has no payoff yet`, `payoff chapter … has passed` | `continuity` | [Unfired setups](#unfired-setups-the-chekhov-warning) |
| `story.md is complete but` | `continuity` | [Finishing the book](#finishing-the-book) |
| `current-chapter … is behind`, `current-chapter … is ahead`, `state.md … references missing`, `is missing knows`, `repeats fact`, `must be a kebab-case id`, `conflicts with`, `must be a mapping` | `continuity` | [Continuity state](#continuity-state) |
| `uses <artifact>, destroyed/lost since`, `mentions <artifact>, destroyed/lost since`, `destroyed/lost with no since chapter`, `references missing since chapter` | `continuity` | [Prop custody](#prop-custody) |
| `timestamp runs backward`, `allows only …h for travel`, `is earlier than Chapter`, `malformed date`, `malformed time`, `negative travel-hours` | `continuity` | [Clock and travel time](#clock-and-travel-time) |
| `puts <character> at <location> …, but the fastest route takes` | `continuity` | [Route travel](#route-travel) |
| `dismissed:` | `continuity` | [Exemptions](#exemptions) |
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
warning: chapters/chapter-03.md POV character nessa-thorn is not listed in characters
warning: continuity/promises/the-sealed-letter.md was planted in chapter-01, 3 chapters ago, and has no payoff yet
warning: continuity/state.md object-state[0] status active conflicts with worldbuilding/artifacts/vales-compass.md status destroyed
```

[Fixing the unraveled thread](#worked-example-fixing-the-unraveled-thread) walks through repairing each of these.

Chapter order is always the chapter's `number`. Chapter references such as `died-in`, `planted`, and `learned-in` are chapter ids (`chapter-02`), which the checker converts to numbers.

### How findings are reported

`continuity`, `timeline`, `pacing`, `clues`, `prose`, `voices`, `names`, `progress`, and `compare` all report the same way. On stderr they print one summary line first, like the first line above, and then each finding on its own line:

- **error** lines are contradictions. They make the command exit 1.
- **warning** lines are things that are probably wrong or stale. They never change the exit code.
- **dismissed** lines are findings that match an entry in `continuity/exemptions.md`. They are shown so nothing is hidden, but they do not count as errors or warnings. Only `continuity` applies exemptions. See [Exemptions](#exemptions).

The report itself (timeline sections, pacing and clue grids, prose counts, voice profiles, progress figures) goes to stdout, so you can redirect it to a file without the findings. File paths in findings are relative to the project root, so you can open them directly.

### What the checker reads

| File | Fields |
|------|--------|
| `characters/*.md` | `status`, `died-in` |
| `worldbuilding/locations/*.md` | `routes` |
| `chapters/chapter-NN.md` | `number`, `status`, `pov`, `characters`, `mentions`, `locations`, `date`, `time` |
| `scenes/*.md` | `chapter`, `scene`, `pov`, `characters`, `mentions`, `location`, `state-changes`, `date`, `time`, `travel-hours` |
| `continuity/promises/*.md` | `status`, `planted`, `payoff` |
| `continuity/questions/*.md` | `status`, `introduced`, `resolved` |
| `continuity/clues/*.md` | `status`, `planted`, `payoff` |
| `continuity/state.md` | `current-chapter`, `character-state`, `knowledge-state`, `object-state` |
| `worldbuilding/artifacts/*.md` | `status` |
| `story.md` | `status` |
| `continuity/exemptions.md` | `exemptions` |

A file that fails to parse is reported as an error, and the rest of the project is still checked.

### Deaths and posthumous appearances

A character with `died-in: chapter-NN` must have `status: deceased`, and must not appear in the cast of any later chapter or scene. A character counts as appearing when they are the `pov` or are listed in `characters`. Flashbacks, memories, letters, recordings, and ghosts belong in `mentions`, which the death check ignores.

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
| error | `<chapter or scene> lists <id>, who died in <chapter>; move posthumous appearances to mentions` | Move the id from `characters` (or `pov`) to `mentions`. If they really are alive, fix `died-in`. |

### Casts and locations

These checks keep the scene records and the chapter frontmatter in step, so the cast lists that other checks rely on can be trusted.

| Severity | Message | Fix |
|----------|---------|-----|
| warning | `<chapter or scene> POV character <id> is not listed in characters` | Add the POV character to `characters`. |
| warning | `<scene> lists <id> but <chapter> does not list them in characters or mentions` | Add the character to the parent chapter's `characters` or `mentions`. |
| warning | `<scene> is set in <location> but <chapter> does not list that location` | Add the location to the chapter's `locations`. |
| warning | `Chapter numbering skips from <n> to <m>` | Add the missing chapter, or renumber. Scaffolding a far-off chapter ahead of time also triggers this. |

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

`story add promise` and `story add clue` default to `status: planted` when you pass `--planted`, and to `planned` otherwise. `story add question` defaults to `open`, or to `answered` when you pass `--resolved`; `--status open` with `--resolved` is an error. Clues accept two more flags: `significance-delayed: true` (`--significance-delayed`) for evidence whose meaning the reader should only see later, and `red-herring: true` (`--red-herring`) for evidence that points the wrong way. `story continuity` checks clues exactly like promises and ignores both flags; [`story clues`](#story-clues) uses them for its fair-play checks.

Entries with `status: abandoned` are skipped entirely. Everything else is checked:

| Severity | Message | Fix |
|----------|---------|-----|
| error | `<promise or clue> pays off in <chapter> before it is planted in <chapter>` | Swap or correct `planted` and `payoff`. |
| error | `<question> resolves in <chapter> before it is introduced in <chapter>` | Swap or correct `introduced` and `resolved`. |
| error | `<promise> is paid-off but has no payoff chapter` (clues: `has status paid-off but no payoff chapter recorded`) | Record `payoff`. |
| error | `<promise> is planted but has no planted chapter` (clues: `is planted but no plant chapter recorded`) | Record `planted`, or set the status back to `planned`. |
| error | `<question> is answered` or `is resolved` `but has no resolved chapter` | Record `resolved`. |
| error | `<question> records resolved chapter <chapter> but status is still open` | Set `status: resolved` (or `answered`), or clear `resolved`. |
| warning | `<promise or clue> records planted chapter <chapter> but status is still planned` | Set `status: planted` once the setup is on the page. The warning appears only once that chapter has prose: it is at or before the latest drafted chapter (see below). |

`story links` separately checks that the chapter ids in these fields exist, with one allowance for scheduling ahead. A promise or clue may name a `chapter-NN` that has no chapter file yet in `payoff`, and in `planted` while its status is `planned`. Once the status is `planted` or `paid-off`, the `planted` chapter must exist, and once it is `paid-off`, the `payoff` chapter must exist too. Question chapters must always exist; scaffold the chapter first (`story add chapter "Title" --number 7`). Outline chapters satisfy the link check without counting as drafted.

#### Unfired setups (the Chekhov warning)

A promise or clue with `status: planted` gets a warning once its `planted` chapter is three or more chapters behind the latest drafted chapter. The latest drafted chapter is the highest-numbered chapter whose `status` is not `outline`, so scaffolding outline chapters ahead of time does not trigger the warning.

| Situation | Result |
|-----------|--------|
| Planted fewer than 3 chapters ago | No warning |
| `payoff` recorded for a chapter still ahead of the latest drafted chapter | No warning: the payoff is scheduled |
| `payoff` recorded for a chapter already drafted | warning: `<file> payoff chapter <chapter> has passed and status is still planted` |
| No `payoff` recorded | warning: `<file> was planted in <chapter>, <n> chapters ago, and has no payoff yet` |

Fix it by paying the setup off and setting `status: paid-off`, by recording a future `payoff` chapter, by setting `status: dropped` or `abandoned` if you cut the thread, or with an [exemption](#exemptions) if the gap is deliberate (for example, the payoff is in the next book). Questions have no gap warning.

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
| `object-state` | `artifact` must be an artifact id; `owner` must be a character or faction id; `location` must be a location id; `status` must match the artifact file; `since` (for destroyed or lost artifacts) must be a chapter id | anything else |

| Severity | Message | Fix |
|----------|---------|-----|
| error | `continuity/state.md current-chapter <n> is ahead of the latest chapter <m>` | Lower `current-chapter` to a chapter that exists. |
| warning | `continuity/state.md current-chapter <n> is behind the latest chapter <m>; update continuity state after drafting` | Bring the state up to date with the chapters you drafted, then raise `current-chapter`. Outline chapters do not count. |
| error | `... <list>[<i>] references missing character`, `location`, `artifact`, `owner`, or `chapter <id>` | Correct the id, or create the missing entity. |
| error | `... knowledge-state[<i>] is missing knows` | Add `knows`. |
| error | `... knowledge-state[<i>] fact <id> must be a kebab-case id` | Use lowercase words joined by hyphens. |
| error | `... knowledge-state[<i>] repeats fact <id> for <character> from knowledge-state[<j>]` | Keep one entry per fact per character. |
| warning | `... object-state[<i>] status <a> conflicts with <artifact file> status <b>` | Make the artifact file and the state entry agree. |
| error | `... <list>[<i>] must be a mapping` | Each list item must be a `key: value` block, not a bare string. |

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
| warning | `continuity/state.md object-state[<i>] is destroyed/lost with no since chapter; custody cannot be checked` | Add `since`. |
| error | `continuity/state.md object-state[<i>] references missing since chapter <chapter>` | Point `since` at an existing chapter. |

Only `object-state` entries with `status: destroyed` or `status: lost` are custody-checked. References in or before the `since` chapter are allowed.

### Clock and travel time

Time checks switch on as soon as any scene or chapter has a `date`. Without dates, there are no time findings at all.

| Field | On | Format |
|-------|----|--------|
| `date` | scene or chapter | A real calendar day, `YYYY-MM-DD` (years 0000 to 9999) |
| `time` | scene or chapter | `HH:MM` (24-hour) or a named part of day |
| `travel-hours` | scene | A YAML number (not a quoted string): the minimum hours of travel needed to reach this scene from the previous one. `story validate` rejects any other value; inside `story continuity` it is treated as 0, which switches the travel check off. |

Named parts of day sort as fixed clock times: `dawn` 05:00, `morning` 07:00, `midday` 12:00, `afternoon` 15:00, `evening` 19:00, `night` 23:00. `HH:MM` needs two-digit hours (`09:00`, not `9:00`). Quoting `HH:MM` times (`time: "22:00"`) keeps other YAML tools from reading them as numbers.

`story add chapter` and `story add scene` reject a bad `--date`, `--time`, or `--travel-hours` when they create the file. `story validate` rejects a non-numeric `travel-hours` and a `date` or `time` that is not a single value, but it does not check date or time formats, so a malformed date or time you type by hand is only reported by `story continuity`, as the warnings below.

The checker walks dated scenes in reading order: by scene number within a chapter, then from the last dated scene of one chapter to the first dated scene of the next. For each step:

- An earlier date, or the same date with an earlier time, is a **backward timestamp** warning.
- If the scene has `travel-hours` and both scenes have a time, the hours between them must be at least `travel-hours`, or it is an error.
- A step with a missing time on the same date is not compared.

Chapter dates are checked separately: a higher-numbered chapter dated earlier than a lower-numbered one is a warning. A chapter's `date` does not apply to its scenes.

In the same copy, the scenes carry these dates. Chapter 3's scene is set the night before chapter 2's, and chapter 4's scene asserts a 30-hour journey from the scene before it:

| Scene | `date` | `time` | Other |
|-------|--------|--------|-------|
| `chapter-01-scene-01` | `1924-10-14` | `night` | |
| `chapter-02-scene-01` | `1924-10-21` | `morning` | |
| `chapter-03-scene-01` | `1924-10-20` | `"22:00"` | `flashback-to: the night of the fire` |
| `chapter-04-scene-01` | `1924-10-21` | `"23:30"` | `travel-hours: 30` |

The chapter 2 to chapter 3 step runs backward, so it gets a warning and no travel check. Chapter 4 is then measured from chapter 3's scene, 25.5 hours earlier. The clock findings from that run (alongside the custody errors above) are:

```text
error: scenes/chapter-04-scene-01.md allows only 25.5h for travel of 30h
warning: scenes/chapter-03-scene-01.md timestamp runs backward
```

| Severity | Message | Fix |
|----------|---------|-----|
| warning | `<scene> timestamp runs backward` | Correct the date or time. If the scene is a deliberate flashback, add an [exemption](#exemptions) for it. |
| error | `<scene> allows only <x>h for travel of <y>h` | Move the scene later, shorten the journey, or lower `travel-hours`. |
| warning | `Chapter <n> date <date> is earlier than Chapter <m> date <date>` | Correct the chapter date, or exempt a flashback chapter. |
| warning | `<scene> has malformed date "<value>"`, `has malformed time "<value>"`, `has negative travel-hours <n>` | Use `YYYY-MM-DD`, `HH:MM` or a named part of day, and a number of hours that is zero or more. A scene with a malformed date is left out of the clock checks. |
| warning | `Chapter <n> has malformed date "<value>"` or `malformed time "<value>"` | As above. |

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

A route is two-way unless the destination records its own route back, in which case each direction uses its own hours (a river that is quicker downstream, for example). The checker finds the fastest path through any number of places, so a harbour-to-mill route and a mill-to-keep route together give a harbour-to-keep time.

Once any location has a valid route, `story continuity` follows every character through the dated scene records. A character is sighted at a scene's `location` when they are its `pov` or are listed in its `characters`; `mentions` do not count. For each sighting, the checker looks back at every earlier sighting of the same character at a different connected place, and reports an error if even the fastest route could not cover the distance in the time between them. Each scene is reported at most once per character.

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

Scenes without a valid `date`, scenes without a `location`, and places with no routes at all are left out. The route check runs alongside the `travel-hours` check and does not replace it.

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
| `the-sealed-letter.md was planted in chapter-01, 3 chapters ago` | Deliberate: the letter pays off in book two. Record an exemption. |

After those edits, in a copy of the project:

```text
$ story continuity .
Continuity is consistent: 0 errors, 0 warnings, 1 dismissed
dismissed: continuity/promises/the-sealed-letter.md was planted in chapter-01, 3 chapters ago, and has no payoff yet (exemption: The letter pays off in book two; the gap is deliberate.)
```

After any continuity fix, run the rest of the maintenance loop (`story reindex .`, `story wordcount . --write`, `story links .`, `story validate .`) so registries and backlinks match.

## Exemptions

Some findings are intentional: a flashback that runs the clock backward, a setup whose payoff is in a sequel, a chapter that names a destroyed heirloom in memory. Record those in `continuity/exemptions.md` instead of bending the frontmatter to silence the checker:

```markdown
---
type: exemption-log
exemptions:
  - pattern: "the-sealed-letter.md was planted in chapter-01"
    reason: "The letter pays off in book two; the gap is deliberate."
---

# Continuity Exemptions

Findings from `story continuity` that are intentional. Each entry needs a reason.
```

How matching works:

- A finding is dismissed when its full text contains `pattern` as a plain, case-sensitive substring. There are no wildcards or regular expressions.
- The first matching entry wins, and its `reason` is printed after the dismissed finding.
- Both errors and warnings can be dismissed. The exit code depends only on the errors that remain.
- A `pattern` shorter than 4 characters (after trimming whitespace) is ignored, so a pattern like `ch` cannot dismiss everything.

Copy the pattern from the finding itself, and keep it specific: include the file name and the chapter, so a new finding of the same kind in another file still shows up. `story report`, `story next`, and `story doctor` count continuity findings after exemptions.

`story validate` checks the file: `type` must be `exemption-log`, `exemptions` must be a list, and each entry needs a non-empty `pattern` of at least 4 characters and a non-empty `reason`. If the file is missing or does not parse, `story continuity` applies no exemptions.

Exemptions apply only to `story continuity`. They do not affect `validate`, `links`, `pacing`, `clues`, `prose`, `voices`, `names`, or `series`.

## Story knowledge

```shell
story knowledge <character-id> --at <chapter-id> [--path <project>]
```

`story knowledge` answers "did she know this yet?" from the `knowledge-state` list in `continuity/state.md`. For the given character it lists, in file order:

- every entry without `learned-in`, marked `pre-existing knowledge`, and
- every entry whose `learned-in` chapter is numbered at or before the `--at` chapter, marked `learned in <chapter>`.

From [`examples/the-last-ember`](../examples/the-last-ember/), where Kael's knowledge carries over from the previous book:

```text
$ story knowledge kael-voss --at chapter-01 --path examples/the-last-ember
- The tunnels from the Vale side reach the Whisper Gate into the High Keep (pre-existing knowledge)
```

In the repaired unraveled thread, Jonas learns which page matters in chapter 4:

```text
$ story knowledge jonas-reed --at chapter-03
No recorded knowledge for jonas-reed at chapter-03
$ story knowledge jonas-reed --at chapter-04
- which ledger page names the firestarter (learned in chapter-04)
```

The command exits 1 with `Unknown character <id>` or `Unknown chapter <id>` if either id does not exist, prints the parse error instead (such as `characters/mara.md: is missing YAML frontmatter`) when the character's file fails to parse, and prints the usage line if you leave out the character or `--at`. Entries whose `learned-in` chapter does not exist are skipped here; `story continuity` reports them as errors.

The answer is only as good as the state file. After drafting a chapter in which someone learns something that matters later, add a `knowledge-state` entry with `learned-in`. Before revising a scene in which a character acts on a secret, run `story knowledge` for that chapter.

## Story timeline

```shell
story timeline .
```

`story timeline` is a read-only view. It never adds findings; `story continuity` owns the clock checks. It exits 1 only when a file does not parse. It prints up to four sections.

**Chronology (story order)** lists every dated scene sorted by date and time, then by reading order. An entry with a date but no valid time sorts as midnight. A chapter with no scene files stands in for its scenes and uses the chapter's own `date` and `time`. An entry is marked `told in chapter <n>, after later events` when something that happens after it in story time was read before it. Scenes with `flashback-to` show that note too.

**Undated (reading order)** lists scenes and scene-less chapters with no valid date. The section is left out when everything is dated.

**POV balance** totals chapter `pov` by chapter count and prose words, largest share first. Chapters with no `pov` are grouped as `unspecified`.

**Character presence** counts the chapters in which each character appears in `characters` (on the chapter or on any of its scenes; `mentions` do not count). It shows the span from first to last appearance, the longest absence, and how many chapters at the end of the book they are missing from. Absences are counted in chapter positions, so gaps in chapter numbering do not inflate them.

With the scene dates from [Clock and travel time](#clock-and-travel-time) on the repaired unraveled thread:

```text
$ story timeline .
Timeline: 4 dated, 0 undated

Chronology (story order):
- 1924-10-14 night  chapter-01-scene-01: The Ash and the Ledger (POV jonas-reed, at the-mill-row)
- 1924-10-20 22:00  chapter-03-scene-01: The Dry Side of Mill Row (POV jonas-reed, at the-mill-row) [told in chapter 3, after later events; flashback to the night of the fire]
- 1924-10-21 morning  chapter-02-scene-01: The Millpond (POV jonas-reed, at the-mill-row)
- 1924-10-21 23:30  chapter-04-scene-01: The Lock Gate (POV jonas-reed, at the-mill-row)

POV balance:
- jonas-reed: 3 chapters, 87 words (78%)
- nessa-thorn: 1 chapter, 24 words (22%)

Character presence:
- jonas-reed: 4 of 4 chapters, chapters 1-4
- edran-vale: 2 of 4 chapters, chapters 1-2, absent from the last 2 chapters
- nessa-thorn: 1 of 4 chapters, chapter 3, absent from the last 1 chapter
Timeline built: 0 errors, 0 warnings, 0 dismissed
```

Without dates, the chronology reads `- None: add date (YYYY-MM-DD) and time to scenes or chapters to order them` and every scene is listed under `Undated (reading order)`. POV balance and presence still work. The unmodified example, where chapter 4 still lists Edran and chapter 3 omits Nessa, shows the other presence notes:

```text
$ story timeline examples/the-unraveled-thread
...
Character presence:
- jonas-reed: 4 of 4 chapters, chapters 1-4
- edran-vale: 3 of 4 chapters, chapters 1-4, longest absence 1 chapter after chapter 2
- nessa-thorn: not present in any chapter
```

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

Set them with `story add scene --outcome yes-but`, `story add scene --sequel --dilemma "<text>"`, and `story add chapter --hook question`, or by hand. `story validate` rejects any other `outcome` or `hook` value.

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
warning: 4 scene units in a row with no sequel (chapter-01-scene-01 to chapter-04-scene-01): give the POV character room to react and decide
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
warning: 3 scenes in a row end in an outright yes (chapter-02-scene-01 to chapter-04-scene-01): raise the cost with yes-but or no-and
warning: 3 chapters in a row end on resolution (chapter-02 to chapter-04): readers can put the book down
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
warning: clue the-constables-silence is a red herring with no payoff: record the chapter that debunks it
warning: clue the-burned-page is planted in the chapter before its reveal (chapter-03 -> chapter-04): late plant gives readers no time to notice it
```

The columns are chapter numbers, in order. Rows are sorted by the chapter that plants them; clues with no `planted` chapter come last. `x` means planted and revealed in the same chapter. After each row come the clue's status and `delayed` if the flag is set. The header counts live clues (`planned`, `planted`, or `paid-off`) and how many of them record a `planted` and a `payoff` chapter.

### Fair-play findings

| Message | Fix |
|---------|-----|
| `clue <id> is revealed in <chapter> but never planted: readers cannot play fair` | Plant the clue earlier and record `planted`, or cut the reveal's reliance on it. |
| `clue <id> is planted in the same chapter as its reveal` or `in the chapter before its reveal (<planted> -> <payoff>): late plant gives readers no time to notice it` | Move the plant at least two chapters before the reveal. Distance is counted in chapter positions, so gaps in numbering do not help. |
| `clue <id> lists no characters: record who could notice it` | List the characters who see, hear, or could find the clue. A clue no one can notice is not fair evidence. |
| `clue <id> is a red herring with no payoff: record the chapter that debunks it` | Write the scene that explains the false lead away, and set `payoff` to its chapter. |
| `no clue is significance-delayed: every clue announces its meaning when planted` | Appears once the book has three or more live clues that are not red herrings and none has `significance-delayed: true`. Hide at least one clue in plain sight, and set the flag. |

To see the same plant-to-reveal flow as a picture, run [`story diagram clues`](#story-diagram). The [`genre-craft`](../skills/genre-craft/SKILL.md) skill's [mystery fair-play reference](../skills/genre-craft/references/mystery-fair-play.md) covers planting technique and red-herring discipline.

## Story prose

```shell
story prose .
```

`story prose` is an advisory prose lint. It counts; it never scores or rewrites. It reads only chapter prose: the text after `## Chapter Text` (or, failing that, after the outline and its `---` divider), without headings, HTML comments, or scene-break rules. Quoted dialogue (straight `"..."`, curly `“...”`, or British `‘...’`, paired the same way as in [`story voices`](#story-voices)) is removed before the filter-word and adverb counts, so a character's own words are not held against the narration. A heading line is dropped on its own, so prose that follows a heading without a blank line still counts.

From [`examples/the-last-ember`](../examples/the-last-ember/), which has a style sheet:

```text
$ story prose examples/the-last-ember
Prose report: 1 chapter, 993 words

chapters/chapter-01.md: The Ember Wakes (993 words)
  Sentences: 135, average 7.4 words, longest 28, spread 6.3
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
warning: chapters/chapter-01.md uses "towards" once; style sheet prefers "toward"
warning: chapters/chapter-01.md uses "gray" once; british dialect prefers "grey"
warning: chapters/chapter-01.md has 3 said-bookism dialogue tags: growled 1, hissed 1, snapped 1
warning: characters sera-voss and seren-hale have similar first names (Sera Voss / Seren Hale)
```

### What each line measures

| Line | Measures | Becomes a warning when |
|------|----------|------------------------|
| Sentences | Sentence count, mean length, longest, and spread (standard deviation of sentence length, in words) | 20 or more sentences with a spread under 5: `sentence lengths are uniform ...; vary the rhythm` |
| Filter words | `felt`, `saw`, `heard`, `noticed`, `realized`, `realised`, `wondered`, `seemed`, `watched`, `knew`, `decided`, `thought`, `sensed` in narration, per 1,000 narration words | Over 10 per 1,000, once the chapter has at least 300 narration words |
| -ly adverbs | Words over four letters ending in `-ly`, minus a built-in list of non-adverbs (`family`, `early`, `only`, ...) and character name parts, per 1,000 narration words | Over 12 per 1,000, once the chapter has at least 300 narration words |
| Dialogue tags | The first of `said`, `asked`, `says`, `asks`, or a said-bookism within three words after a closing quote, including a British `’` that closes a single-quoted line | 3 or more said-bookisms in a chapter |
| Echoes | Words of five or more letters repeated within 30 words, excluding common words, character names, and numbers | Never; the counts are for rereading |
| Watch words | Each `watch-words` entry from the style sheet | Never; the counts are for rereading |
| Spelling | Uses of each `avoid` spelling from the style sheet or the chosen dialect | Always, one warning per spelling per chapter |
| Repeated 4-word phrases | The ten most frequent four-word phrases used three or more times across the manuscript, ignoring phrases made only of common words | Never |
| Similar character names | First names of three or more letters that are identical, share their first three letters, or are one edit apart (two edits when both names have five or more letters) | Always: `characters <a> and <b> have similar first names` |

The said-bookism list includes tags such as `barked`, `growled`, `hissed`, `laughed`, `smiled`, `snapped`, and `sighed`. `whispered`, `muttered`, and `shouted` are left out on purpose, because they describe volume, which `said` cannot.

Prose findings are always warnings. `story prose` exits 0 on any readable project, so you can run it freely.

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

Matches are case-insensitive whole words, so `grey-haired` still counts as a use of `grey`. `story validate` checks the style sheet's shape: `type: style-sheet`, a known `dialect`, and a non-empty, different `use` and `avoid` in each `preferred` entry.

### Acting on the report

Treat the counts as a list of places to reread, not a list of errors. Filter words and adverbs above the threshold usually mark a passage told at a distance; said-bookisms usually mean the action should be its own beat. A repeated phrase across the manuscript is often a tic. An avoided spelling is a copyedit fix. Similar names are cheapest to fix before the draft is finished, and [`story names`](#story-names) catches them before a name is used at all. The [`line-editing`](../skills/line-editing/SKILL.md) skill uses this report for its line-edit and copyedit passes.

## Story voices

```shell
story voices .
```

`story voices` fingerprints each character's dialogue from the chapter prose, so you can see whether characters sound different from each other and from how you described them. It is advisory: every finding is a warning, and it exits 0 on any readable project.

### How lines are attributed

It never guesses who is speaking. A paragraph's quoted lines (straight `"..."`, curly `“...”`, or British `‘...’`) go to a character only when the narration around them says who spoke:

1. A speech tag: the character's name next to a speech verb such as `said`, `asked`, `replied`, `whispered`, `muttered`, `called`, `snapped`, or `went on`. A name before the verb wins over one after it, so in `"...," Sera told Kael` the line is Sera's, and `said Kael` gives it to Kael.
2. Failing that, an action beat: narration that names exactly one character (`Kael shouldered his pack. "For the record..."`).

Anything else is counted as unattributed. A character is matched by their full `name`, their given name (the first word that is not a title, so `Lord Maren` also matches `Maren`), and their `aliases`, case-sensitively. Pronoun tags (`she said`) are never attributed, so in close third person the POV character is often under-counted. Characters with `status: cut` are ignored.

### What it prints

From [`examples/the-last-ember`](../examples/the-last-ember/):

```text
$ story voices examples/the-last-ember
Voices: 1 speaking characters, 35 unattributed lines

kael-voss: 9 lines, 76 words
  Sentence length 5.1, contractions 2.6 per 100 words, questions 7%, exclamations 0%
  Signature words: jumpy, good, looking, sera, soldiers
Voice check complete: 0 errors, 0 warnings, 0 dismissed
```

Sera speaks most of the chapter's dialogue, but her lines are tagged only with pronouns (`she said`, `she murmured`) or not at all, so none of it is attributed. Each profile, largest first, shows:

- **Lines and words** of attributed dialogue.
- **Sentence length**: mean words per spoken sentence.
- **Contractions** per 100 words spoken (`don't`, `we're`, `I'd`).
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

`voice-words` are words and phrases the character does say; `voice-avoid` are ones they would never say. Both are lists of strings, matched as whole words or phrases, case-insensitively, with either straight or curly apostrophes. The [`voice-style`](../skills/voice-style/SKILL.md) skill records them.

### Voice findings

In a copy of the last ember with those fields on Kael, and Sera's four pronoun tags (three `she said`, one `she murmured`) changed to `Sera said` or `Sera murmured`, which gives her six attributed lines:

```text
$ story voices .
Voices: 2 speaking characters, 29 unattributed lines

kael-voss: 9 lines, 76 words
  Sentence length 5.1, contractions 2.6 per 100 words, questions 7%, exclamations 0%
  Signature words: jumpy, good, looking, sera, soldiers

sera-voss: 6 lines, 28 words
  Sentence length 4.7, contractions 0.0 per 100 words, questions 0%, exclamations 0%
  Signature words: none yet
Voice check complete: 0 errors, 2 warnings, 0 dismissed
warning: kael-voss says "good", which is in their voice-avoid list (chapter-01)
warning: kael-voss never says "aye" from their voice-words list in 9 lines of dialogue
```

| Message | Appears when | Fix |
|---------|--------------|-----|
| `<id> says "<phrase>", which is in their voice-avoid list (<chapters>)` | Any attributed line contains the phrase. The chapters that use it are listed. | Rewrite the line, or remove the phrase from `voice-avoid` if the character has changed. |
| `<id> never says "<phrase>" from their voice-words list in <n> lines of dialogue` | The character has five or more attributed lines and none uses the phrase. | Work the phrase in where it fits, or drop it from `voice-words`. |
| `<a> and <b> may sound alike: similar sentence length, contractions, questions, and exclamations` | Both have five or more lines, and all four measures are close: sentence length within 1.5 words, contractions within 1.5 per 100 words, and question and exclamation shares each within 10 points. | Separate them on more than one axis: sentence length, contractions, vocabulary, what they ask about. Here Kael and Sera are not flagged, because their contraction rates differ by 2.6. |

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
warning: "Marra Quinn" looks like character mara-quill (Mara Quill)
warning: "Ilse Varn" shares an initial with antagonist ilya-venn (Councillor Ilya Venn)
warning: "Ivo" shares an initial with antagonist ilya-venn (Councillor Ilya Venn)
```

Each candidate gets one verdict on stdout: `taken` (an error), `check` (a warning), or `clear`. Names are compared ignoring case, accents, and punctuation.

| Severity | Message | Appears when |
|----------|---------|--------------|
| error | `"<name>" clashes with <kind> <id> (<existing>)` | The candidate matches an existing name or alias exactly, or its given name matches a character's given name. `"Port Kestrel"` clashes with the location of that name. |
| warning | `"<name>" looks like <kind> <id> (<existing>)` | The given names (for characters) or single-word names look alike: both three letters or more, and they share their first four letters, or share a first letter and are one edit apart (two edits when both have five letters or more). Multi-word place and term names are only compared exactly. |
| warning | `"<name>" shares an initial with <role> <id> (<existing>)` | The candidate's given name starts with the same letter as a `protagonist`, `antagonist`, `deuteragonist`, or `narrator`, and does not already look like it. Readers skim names by their first letter. |

The command exits 1 when any candidate clashes, and 0 when there are only warnings. Titles and articles (`Lord`, `Captain`, `The`, and so on) are skipped when finding a given name, so `Captain Mara Dole` clashes with Mara Quill. It checks only the current project; for a series, run it in each book. The [`character-management`](../skills/character-management/SKILL.md) and [`worldbuilding`](../skills/worldbuilding/SKILL.md) skills run it before settling a name, and [`story prose`](#story-prose) catches similar first names among characters already in the bible.

## Story diagram

```shell
story diagram <kind> [--path <project>] [--out <file>]
```

`story diagram` prints [Mermaid](https://mermaid.js.org/) source generated from frontmatter. The output is text, so it diffs cleanly, renders on GitHub and in most markdown editors, and can be rebuilt at any time from the same fields the checks read.

| Kind | Draws | From |
|------|-------|------|
| `relationships` | A family tree and relationship map. Family links (`parent`, `sibling`, `spouse`, `cousin`, and so on) are solid lines, with an arrow from the elder side for `parent`, `grandparent`, `aunt`, and `uncle`; other relationships are dotted and labelled with their `type`. Deceased characters have a dashed outline. | Character `relationships`, `status` |
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
  ilya_venn -.-|adversary| mara_quill
  ilya_venn -.-|former-supervisor| theo_quill
  mara_quill ===|sibling| theo_quill
  classDef deceased stroke-dasharray: 4 4,color:#888
  class theo_quill deceased
$ story diagram locations --path examples/harbor-of-second-light
flowchart LR
  bellwether_reef["Bellwether Reef<br/>Western Shoals"]
  port_kestrel["Port Kestrel<br/>Western Shoals"]
  port_kestrel ---|0.5h dive skiff| bellwether_reef
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
  chapter_01 -->|Edran's Margin Notes| chapter_04
  chapter_03 -->|The Burned Page| chapter_04
  chapter_02 -.->|The Constable's Silence (red herring)| unrevealed(("not yet revealed"))
  classDef open stroke-dasharray: 4 4
  class unrevealed open
```

Node ids replace hyphens with underscores, because Mermaid cannot always parse hyphens next to arrows; the labels carry the readable names. An id that is a Mermaid keyword, such as `end`, `graph`, `subgraph`, `style`, `class`, or `click`, gets `_node` appended, so a location called `end` becomes `end_node`. In the timeline, colons in times and titles become `∶`, because Mermaid's timeline syntax splits on colons.

To paste a diagram into a markdown file, wrap it in a fenced block with the language `mermaid`. To save it instead, pass `--out`:

```text
$ story diagram timeline --out dist/timeline.mmd
Wrote timeline diagram to /home/you/books/the-unraveled-thread/dist/timeline.mmd
```

A relative `--out` path is resolved against the project root and must stay inside it; `dist/` keeps diagrams with the other disposable build output. Nothing is written if any project file fails to parse, because a diagram drawn from a partial scan would silently drop entities. A missing or unknown kind exits 1 with `Unknown diagram kind: <kind>. Supported kinds: relationships, locations, timeline, clues, arcs`.

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
| `chapters/chapter-NN.md` | `target-words` | Word target for the chapter (positive integer) |
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

Chapter targets:
- chapter-01: 993 of 3,500 words (28%)
Progress checked: 0 errors, 0 warnings, 0 dismissed
```

- **Deadline** shows the words a day needed to finish on time, or `passed <n> days ago`. Without `target-words`, it shows only the days left.
- **Sessions** shows the change in words since the last logged session.
- **Pace** is the words gained per calendar day across the last seven logged sessions. It needs at least two sessions on different days.
- **Projected finish** extends that pace from today to the target. It is omitted when the pace is zero or negative, or when the target is met.
- **Chapter targets** lists only chapters that set `target-words`.

Without `target-words`, the first line reads `Progress: <n> words (no target-words in story.md)`. Without sessions, the sessions line reads `Sessions: none logged (run story progress --log after a writing session)`. The unmodified example shows both:

```text
$ story progress examples/the-last-ember
Progress: 993 words (no target-words in story.md)
Sessions: none logged (run story progress --log after a writing session)
Progress checked: 0 errors, 0 warnings, 0 dismissed
```

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

- Chapters are matched by id (`chapter-04`), not by title or content. A chapter renumbered into a free slot shows as one removed and one added; two chapters that swap numbers both show as changed.
- **% of paragraphs unchanged** is the share of the current chapter's paragraphs that appear word for word in the earlier version, ignoring whitespace. A chapter with 0% has had every paragraph touched, even if only lightly.
- A chapter is `unchanged` only when every paragraph matches and the paragraph count is the same.

The [`revision-continuity`](../skills/revision-continuity/SKILL.md) skill takes a snapshot before any multi-chapter pass and runs `story compare` afterwards; see [Writing workflows](writing-workflows.md#revision-passes).

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

`story passes` exits 0 unless it cannot write: a pass name that is not kebab-case exits 1 with `Revision pass names must be kebab-case, got <name>`, and a `revision-passes` list that `story validate` would reject exits 1 with `Fix revision-passes in story.md before changing it: ...`. `story validate` requires a list of objects, each with a kebab-case `pass` listed once and an optional `status` of `pending` (the default), `in-progress`, or `done`.

While `story.md` has `status: revising`, [`story next`](#story-next) turns the ladder into an action: `Plan revision passes` when none are recorded, then `Revision pass: <name>` with the pass's focus and checks, until every pass is done. The [`revision-continuity`](../skills/revision-continuity/SKILL.md) skill works through the passes one at a time.

## Report, next, and doctor

These three commands run `validate`, `links`, and `continuity` together and summarise the results. They exit 0 whatever the checks find (only a folder without `story.md` makes them exit 1): use them to decide what to do, and use the individual checks in scripts and CI.

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
- [P2] Review promises and payoffs: 1 setup/payoff promises need planting or payoff decisions.
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
- [P3] Project is mechanically healthy: No deterministic maintenance issues are blocking the next writing pass.
- [P2] Draft chapter 2: Use story add chapter "Chapter 2" --number 2 --path examples/the-last-ember, then outline scenes to advance Sera's Reclamation.
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
- [P2] Review promises and payoffs: 1 setup/payoff promises need planting or payoff decisions.
- [P2] Review open clues: 1 clues are still planned or planted.
- [P2] Draft chapter 5: Use story add chapter "Chapter 5" --number 5, then outline scenes to advance The Ledger Trail.
```

Before any passes are recorded, the same line reads `[P1] Plan revision passes: Run story passes --init to record the structure-to-proof pass ladder, then work one pass at a time.` A custom pass reads `Work through this pass.` with no checks. Once every pass is done, the line disappears.

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
- [P2] Review promises and payoffs: 1 setup/payoff promises need planting or payoff decisions.
- [P2] Review open clues: 1 clues are still planned or planted.
- [P2] Draft chapter 5: Use story add chapter "Chapter 5" --number 5 --path examples/the-unraveled-thread, then outline scenes to advance The Ledger Trail.
```

### Actions and priorities

All three commands build the same action list. It is sorted by priority, P0 first, and actions with the same priority appear in the order below. The P3 "Project is mechanically healthy" line is the exception: it comes first when it appears.

| Priority | Action | Appears when |
|----------|--------|--------------|
| P0 | Fix validation errors | `story validate` has errors |
| P0 | Fix broken references | `story links` has errors |
| P0 | Fix continuity contradictions | `story continuity` has errors after exemptions |
| P1 | Review continuity warnings | `story continuity` has warnings after exemptions |
| P1 | Refresh word counts | A chapter's `word-count` differs from its prose |
| P1 | Add scene records | A chapter has no scene files in `scenes/` |
| P1 | Plan revision passes | `story.md` has `status: revising` and no `revision-passes` |
| P1 | Revision pass: `<name>` | `story.md` has `status: revising` and a pass that is not done |
| P2 | Track open questions | A question has `status: open` |
| P2 | Review promises and payoffs | A promise is `planned` or `planted` |
| P2 | Review open clues | A clue is `planned` or `planted` |
| P2 | Draft chapter N | Always: the chapter after the highest number, naming up to three unresolved arcs |
| P2 | Create first character | The project has no characters |
| P3 | Project is mechanically healthy | Nothing else applies except drafting the next chapter; listed first |

Work down from P0. P0 and P1 items are mechanical and have a command to run. P2 items are writing decisions.

## When to run what

| Moment | Commands |
|--------|----------|
| Start of a session | `story next .` |
| Before naming a character, place, or term | `story names "<candidate>" --path .` |
| After drafting or revising a chapter | `story wordcount . --write`, `story reindex .`, `story links .`, `story validate .`, `story continuity .`, `story pacing .` |
| Before writing a scene that turns on a secret | `story knowledge <id> --at <chapter-id>` |
| Planning structure or pacing | `story timeline .`, `story pacing .`, `story diagram arcs` |
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

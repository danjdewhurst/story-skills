# Continuity and analysis

This page is for writers and agents who want to know what the `story` CLI can check about a manuscript, and what to do when it finds something. It covers the continuity engine (deaths, casts, promises, questions, clues, state, prop custody, and clock), exemptions, and the analysis commands: `knowledge`, `timeline`, `prose`, `progress`, `compare`, `report`, `next`, and `doctor`. All of them are read-only except `story progress --log`, which adds or replaces today's entry in `progress.md`.

All of these commands are deterministic. They read your markdown frontmatter and chapter prose, never call a model, never rewrite prose, and give the same answer every time for the same files. They only flag contradictions that the frontmatter makes visible. Judgement calls, such as whether a character acts on knowledge they have not learned yet, are left to you or to the [`revision-continuity`](../skills/revision-continuity/SKILL.md) skill.

For flags and exit codes of every command, see the [CLI reference](cli-reference.md). For the full field list of each file, see the [Project format reference](project-format.md).

**On this page**

- [At a glance](#at-a-glance)
- [Find your message](#find-your-message)
- [Story continuity](#story-continuity): [how findings are reported](#how-findings-are-reported), [deaths](#deaths-and-posthumous-appearances), [casts](#casts-and-locations), [promises, questions, and clues](#promises-questions-and-clues), [state](#continuity-state), [prop custody](#prop-custody), [clock](#clock-and-travel-time), [worked example](#worked-example-fixing-the-unraveled-thread)
- [Exemptions](#exemptions)
- [Story knowledge](#story-knowledge)
- [Story timeline](#story-timeline)
- [Story prose](#story-prose)
- [Story progress](#story-progress)
- [Story compare](#story-compare)
- [Report, next, and doctor](#report-next-and-doctor)
- [When to run what](#when-to-run-what)

## At a glance

| Command | Answers |
|---------|---------|
| [`story continuity [path]`](#story-continuity) | Does the recorded story contradict itself? |
| [`story knowledge <id> --at <chapter-id>`](#story-knowledge) | What did this character know by this chapter? |
| [`story timeline [path]`](#story-timeline) | What order do events happen in story time? Whose book is it? Who disappears? |
| [`story prose [path]`](#story-prose) | Where does the prose lean on filter words, adverbs, said-bookisms, or off-sheet spellings? |
| [`story progress [path]`](#story-progress) | How far along is the draft against its targets and deadline? |
| [`story compare [path]`](#story-compare) | How much did this revision pass change? |
| [`story report [path]`](#story-report) | What is in this project and do the checks pass? |
| [`story next [path]`](#story-next) | What should I do next? |
| [`story doctor [path]`](#story-doctor) | What is broken and how do I repair it? |

Every command except `knowledge` takes the project as an optional positional path or `--path`. `knowledge` takes only `--path`, because its positional argument is the character id. Of these, only `continuity` fails because of what the story says. The others exit 1 only on bad arguments or files that do not parse; `prose` findings are always warnings, and `report`, `next`, and `doctor` exit 0 whatever the checks find. For when each command exits 1, see [Output streams and exit codes](cli-reference.md#output-streams-and-exit-codes).

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
| `dismissed:` | `continuity` | [Exemptions](#exemptions) |
| `filter words per 1,000`, `-ly adverbs per 1,000`, `said-bookism dialogue tags`, `sentence lengths are uniform`, `have similar first names` | `prose` | [What each line measures](#what-each-line-measures) |
| `style sheet prefers`, `british dialect prefers`, `american dialect prefers` | `prose` | [The style sheet](#the-style-sheet) |
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

`continuity`, `timeline`, `prose`, `progress`, and `compare` all report the same way. On stderr they print one summary line first, like the first line above, and then each finding on its own line:

- **error** lines are contradictions. They make the command exit 1.
- **warning** lines are things that are probably wrong or stale. They never change the exit code.
- **dismissed** lines are findings that match an entry in `continuity/exemptions.md`. They are shown so nothing is hidden, but they do not count as errors or warnings. See [Exemptions](#exemptions).

The report itself (timeline sections, prose counts, progress figures) goes to stdout, so you can redirect it to a file without the findings. File paths in findings are relative to the project root, so you can open them directly.

### What the checker reads

| File | Fields |
|------|--------|
| `characters/*.md` | `status`, `died-in` |
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

`story add promise` and `story add clue` default to `status: planted` when you pass `--planted`, and to `planned` otherwise. Clues also accept `significance-delayed: true` for evidence whose meaning the reader should only see later. The checker records that flag but does not act on it.

Entries with `status: abandoned` are skipped entirely. Everything else is checked:

| Severity | Message | Fix |
|----------|---------|-----|
| error | `<promise or clue> pays off in <chapter> before it is planted in <chapter>` | Swap or correct `planted` and `payoff`. |
| error | `<question> resolves in <chapter> before it is introduced in <chapter>` | Swap or correct `introduced` and `resolved`. |
| error | `<promise> is paid-off but has no payoff chapter` (clues: `has status paid-off but no payoff chapter recorded`) | Record `payoff`. |
| error | `<promise> is planted but has no planted chapter` (clues: `is planted but no plant chapter recorded`) | Record `planted`, or set the status back to `planned`. |
| error | `<question> is answered` or `is resolved` `but has no resolved chapter` | Record `resolved`. |
| error | `<question> records resolved chapter <chapter> but status is still open` | Set `status: resolved` (or `answered`), or clear `resolved`. |
| warning | `<promise> records planted chapter <chapter> but status is still planned` | Set `status: planted` once the setup is on the page. |

`story links` separately checks that every chapter id in these fields exists, so a payoff you plan for a chapter you have not created yet is a link error. Scaffold the chapter first (`story add chapter "Title" --number 7`); outline chapters satisfy the link check without counting as drafted.

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

Exemptions apply only to `story continuity`. They do not affect `validate`, `links`, `prose`, or `series`.

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

The command exits 1 with `Unknown character <id>` or `Unknown chapter <id>` if either id does not exist, and prints the usage line if you leave out the character or `--at`. Entries whose `learned-in` chapter does not exist are skipped here; `story continuity` reports them as errors.

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

## Story prose

```shell
story prose .
```

`story prose` is an advisory prose lint. It counts; it never scores or rewrites. It reads only chapter prose: the text after `## Chapter Text` (or, failing that, after the outline and its `---` divider), without headings, HTML comments, or scene-break rules. Quoted dialogue is removed before the filter-word and adverb counts, so a character's own words are not held against the narration.

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
| Dialogue tags | The first of `said`, `asked`, `says`, `asks`, or a said-bookism within three words after a closing quote | 3 or more said-bookisms in a chapter |
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

Treat the counts as a list of places to reread, not a list of errors. Filter words and adverbs above the threshold usually mark a passage told at a distance; said-bookisms usually mean the action should be its own beat. A repeated phrase across the manuscript is often a tic. An avoided spelling is a copyedit fix. Similar names are cheapest to fix before the draft is finished. The [`revision-continuity`](../skills/revision-continuity/SKILL.md) skill uses this report for line-edit and copyedit passes.

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
- Clues: 0
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
- [P0] Fix continuity contradictions: Run story continuity . and repair 4 deterministic continuity errors.
- [P1] Review continuity warnings: Run story continuity . and review 3 continuity warnings.
- [P2] Review promises and payoffs: 1 setup/payoff promises need planting or payoff decisions.
- [P2] Draft chapter 5: Use story add chapter "Chapter 5" --number 5, then outline scenes to advance The Ledger Trail.
```

The report also shows `Series` when `story.md` sets one, `Research notes` when there are any, and `Target words` with a percentage when `target-words` is set.

### story next

`story next` prints the check summary and the action list, and nothing else. It is the quickest way to start a writing session:

```text
$ story next examples/the-last-ember
# Next Writing Actions: The Last Ember

Checks: validate ok (0 errors, 0 warnings), links ok (0 errors, 0 warnings), continuity ok (0 errors, 0 warnings)

Actions:
- [P3] Project is mechanically healthy: No deterministic maintenance issues are blocking the next writing pass.
- [P2] Draft chapter 2: Use story add chapter "Chapter 2" --number 2, then outline scenes to advance Sera's Reclamation.
```

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
- [P0] Fix continuity contradictions: Run story continuity . and repair 4 deterministic continuity errors.
- [P1] Review continuity warnings: Run story continuity . and review 3 continuity warnings.
- [P2] Review promises and payoffs: 1 setup/payoff promises need planting or payoff decisions.
- [P2] Draft chapter 5: Use story add chapter "Chapter 5" --number 5, then outline scenes to advance The Ledger Trail.
```

### Actions and priorities

All three commands build the same action list, in this order:

| Priority | Action | Appears when |
|----------|--------|--------------|
| P0 | Fix validation errors | `story validate` has errors |
| P0 | Fix broken references | `story links` has errors |
| P0 | Fix continuity contradictions | `story continuity` has errors after exemptions |
| P1 | Review continuity warnings | `story continuity` has warnings after exemptions |
| P1 | Refresh word counts | A chapter's `word-count` differs from its prose |
| P1 | Add scene records | A chapter has no scene files in `scenes/` |
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
| After drafting or revising a chapter | `story wordcount . --write`, `story reindex .`, `story links .`, `story validate .`, `story continuity .` |
| Before writing a scene that turns on a secret | `story knowledge <id> --at <chapter-id>` |
| Planning structure or pacing | `story timeline .` |
| Line edit or copyedit | `story prose .` |
| End of a session | `story progress . --log` |
| After a multi-chapter revision pass | `story compare . --ref <snapshot>` |
| Something is failing and you do not know why | `story doctor .` |

Books linked with `follows` or `precedes` also need `story series .`, which checks canon shared across books; see [Series](series.md). To run the checks on every push, see [Automation and CI](automation.md).

## See also

- [CLI reference](cli-reference.md): every command and flag
- [Project format reference](project-format.md): every frontmatter field these checks read
- [Writing workflows](writing-workflows.md): the revision passes that use these commands
- [Skills catalogue](skills.md): the `revision-continuity`, `voice-style`, and `story-maintenance` skills
- [Series](series.md): shared canon and `fact` ids across books
- [Documentation index](README.md): every page, by audience and task

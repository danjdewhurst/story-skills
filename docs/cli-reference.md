# CLI reference

This page lists every command and option of `story`, the deterministic maintenance CLI that ships with Story Skills. Use it when you need a command's exact usage, the options it accepts, what it writes, and how it exits. For what the files mean, see [Project format reference](project-format.md); for where each command fits in a writing session, see [Writing workflows](writing-workflows.md).

The CLI never writes story content for you. It scaffolds files, rebuilds registries, counts words, runs checks, and produces disposable outputs. You and your agent write the prose and story decisions directly in markdown.

**On this page**

- [Running the CLI](#running-the-cli) and the [example projects](#example-projects-used-on-this-page)
- [Command summary](#command-summary)
- [How the CLI behaves](#how-the-cli-behaves)
- [Setup commands](#setup-commands): `init`, `import`, `migrate`
- [Maintenance commands](#maintenance-commands): `validate`, `reindex`, `wordcount`, `links`
- [Analysis commands](#analysis-commands): `continuity`, `knowledge`, `compare`, `progress`, `timeline`, `prose`, `series`, `report`, `next`, `doctor`
- [Entity commands](#entity-commands): `add`, `rename`, `remove`
- [Output commands](#output-commands): `export`, `build`, `synopsis`
- [Option index](#option-index)
- [The bundled fallback](#the-bundled-fallback)

## Running the CLI

The CLI needs Node 18 or newer and has no runtime dependencies. Pick whichever of these fits how you installed Story Skills:

| How you have it | Command |
|---|---|
| Installed globally with `npm install -g story-skills` | `story <command>` |
| Not installed | `npx story-skills <command>` |
| Unreleased changes from GitHub | `npx --yes --package github:danjdewhurst/story-skills story <command>` |
| A clone of this repository | `bun run story -- <command>` |
| Skills copied into an agent, no package | `node <skills-dir>/story-maintenance/scripts/story.js <command>` |

All five run the same code. The examples on this page use `story`. See [Getting started](getting-started.md) for installation.

### Example projects used on this page

Most examples run against copies of the sample projects in [`examples/`](../examples/): [`the-last-ember`](../examples/the-last-ember/), [`the-unraveled-thread`](../examples/the-unraveled-thread/) (broken on purpose, for the checks), and [`harbor-of-second-light`](../examples/harbor-of-second-light/). The rest use **The Salt Road**, a new project created with `story init "The Salt Road"` and filled with the commands shown under [add](#add). Its protagonist starts as Ilse Marrow and becomes `ilse-varrow` under [rename](#rename); her home port is `gull-harbour`.

Absolute paths in output are shortened to `~/stories/...`.

## Command summary

| Group | Command | What it does | Writes files |
|---|---|---|---|
| Setup | [`init <title>`](#init) | Scaffold a new story project | Yes |
| | [`import <source>`](#import) | Split an existing manuscript into a new project | Yes |
| | [`migrate [path]`](#migrate) | Upgrade a project to the current schema | Yes |
| Maintenance | [`validate [path]`](#validate) | Check structure, frontmatter, and registries | No |
| | [`reindex [path]`](#reindex) | Rebuild registry tables from entity files | Yes |
| | [`wordcount [path]`](#wordcount) | Count chapter prose words | With `--write` |
| | [`links [path]`](#links) | Check cross-references and backlinks | No |
| Analysis | [`continuity [path]`](#continuity) | Check deaths, promises, questions, casts, and state | No |
| | [`knowledge <id>`](#knowledge) | List what a character knew at a chapter | No |
| | [`compare [path]`](#compare) | Compare chapters with an earlier draft | No |
| | [`progress [path]`](#progress) | Show words against targets and deadline | With `--log` |
| | [`timeline [path]`](#timeline) | Show scenes in story-time order, POV balance, presence | No |
| | [`prose [path]`](#prose) | Lint chapter prose | No |
| | [`series [path]`](#series) | Order linked books and check shared canon | No |
| | [`report [path]`](#report) | Summarise inventory, progress, and checks | No |
| | [`next [path]`](#next) | Recommend the next actions | No |
| | [`doctor [path]`](#doctor) | Show health checks and repair steps | No |
| Entities | [`add <kind> <name>`](#add) | Create an entity file and reindex | Yes |
| | [`rename <kind> <id> <name>`](#rename) | Rename an entity and update references | Yes |
| | [`remove <kind> <id>`](#remove) | Delete an entity and scrub references | Yes |
| Output | [`export [path]`](#export) | Write a combined manuscript markdown file | Yes |
| | [`build [path]`](#build) | Build markdown, EPUB, DOCX, or Shunn output in `dist/` | Yes |
| | [`synopsis [path]`](#synopsis) | Print or write a 1- or 3-page synopsis from arcs | With `--out` |

## How the CLI behaves

### Help and version

`story --help`, `story -h`, `story help`, and `story` with no command all print the usage summary to stdout and exit 0. `--help` wins over any command it is combined with, so `story build --help` prints the same summary.

`story --version` (or `-v`) prints the version and exits 0. It wins over everything else on the line, including `--help`:

```shell
story --version
```

```text
0.8.2
```

An unknown command prints `Unknown command: <name>` followed by the usage summary to stderr, and exits 1.

The help text is generated from the command and option registries in [`src/commands.js`](../src/commands.js) and [`src/options.js`](../src/options.js), so it always matches what the CLI accepts. The version comes from [`src/version.js`](../src/version.js).

### Project paths

Every command except `init` and `import` works on one story project: a directory with a `story.md` at its root. How you point a command at that directory depends on the command.

| Commands | How to give the project | Default |
|---|---|---|
| `validate`, `reindex`, `wordcount`, `links`, `continuity`, `compare`, `progress`, `timeline`, `prose`, `series`, `report`, `next`, `doctor`, `migrate`, `export`, `build`, `synopsis` | A positional `[path]` **or** `--path <path>` | Current directory |
| `knowledge`, `add`, `rename`, `remove` | `--path <path>` only, because their positionals are ids and names | Current directory |
| `init`, `import` | Neither. They create a new project; use `--dir` to choose where | A directory named after the story id |

Relative paths resolve against the current working directory. These are equivalent:

```shell
cd ~/stories/the-last-ember && story validate
story validate ~/stories/the-last-ember
story validate --path ~/stories/the-last-ember
```

If you give both a positional path and `--path`, they must resolve to the same directory:

```shell
story validate the-last-ember --path the-salt-road
```

```text
Conflicting project paths: the-last-ember and --path the-salt-road. Use either a positional path or --path, not both.
```

`init` and `import` refuse `--path` so it cannot be mistaken for the target directory:

```shell
story init "Tide Book" --path x
```

```text
init uses --dir for the target directory. --path is the project root for other commands.
```

A command pointed at a directory without `story.md` fails before doing anything:

```shell
story report /tmp
```

```text
/tmp is not a story project: missing story.md
```

`validate` is the exception: it lists every missing required path instead, which makes it useful for diagnosing a half-built project.

### Option syntax

- Options can appear anywhere after the command: `story build --format epub .` and `story build . --format epub` are the same.
- Value options take the next argument (`--out book.md`) or an inline value (`--out=book.md`). Use the inline form when the value itself starts with `--` or is `-h` or `-v`, which would otherwise be read as an option.
- Boolean flags (`--force`, `--write`, `--log`, `--shunn`, `--actionable`, `--sequel`, `--significance-delayed`) are true when present. They also accept an explicit value, inline or as the next argument: `true`, `false`, `yes`, `no`, `on`, `off`, `1`, or `0`. So `--write false` turns writing off, while `--write=maybe` is an error.
- Repeatable options collect every value, and list options also split on commas, so `--character ilse-marrow --character tobin-reyes` and `--characters ilse-marrow,tobin-reyes` produce the same list. `--source`, `--follows`, and `--precedes` keep each value whole.
- Do not mix a singular flag with its plural alias in one `add` command: when both are given, the plural form wins and the singular values are dropped (except `add character --arc`, which is single-valued and has no plural alias). `init` and `import` are the exception: they combine `--theme` and `--themes`.
- For options that are not repeatable, the last value wins: `--out a.md --out b.md` writes `b.md`.
- Unknown options and missing values are errors:

```text
$ story validate --verbose
Unknown option --verbose

$ story export --out
Missing value for --out: expected a value
```

### Output streams and exit codes

The CLI prints results to stdout and diagnostics to stderr.

- `validate`, `links`, and `continuity` write everything to **stderr**: a summary line, then one line per `error:`, `warning:`, and `dismissed:` finding. Nothing goes to stdout.
- `compare`, `progress`, `timeline`, `prose`, and `series` write their report to stdout, then the same summary and finding lines to stderr.
- All other commands write a short confirmation or report to stdout.
- Errors that stop a command (a bad option, a missing project, an unknown id) print one line to stderr. An unknown command also prints the usage summary.

The examples on this page show stdout and stderr together, as a terminal does.

| Exit code | Meaning |
|---|---|
| `0` | The command succeeded. For checks, there were no errors. Warnings and dismissed findings do not change the exit code. |
| `1` | A check found at least one error, the command failed (unknown command or option, missing value, invalid argument, missing project, refused write), or `knowledge` was called without its required arguments. |

`report`, `next`, and `doctor` summarise check results but always exit 0 on a readable project. Use `validate`, `links`, and `continuity` when you need a failing exit code, for example in CI (see [Automation and CI](automation.md)).

### Where commands write

Commands that write files keep them inside the project root. A relative `--out` path resolves against the **project root**, not the current directory, and must stay inside it:

```shell
story export --out ../outside.md
```

```text
Refusing to access path outside project root: ~/stories/outside.md
```

An absolute `--out` path is written where you say. The CLI also refuses to write through symlinks or into symlinked project directories. Scans skip `dist/` and dot-directories, so build output never feeds back into checks.

## Setup commands

### init

```text
story init <title> [options]
```

Scaffolds a new story project: `story.md`, `style-sheet.md`, `plot/timeline.md`, `continuity/state.md`, every required directory, and empty registries. The story id is the kebab-case form of the title (`The Salt Road` becomes `the-salt-road`), and the project goes in a directory of that name unless you pass `--dir`. The title must contain at least one ASCII letter or digit.

| Option | Effect | Default |
|---|---|---|
| `--dir <path>` | Target directory | `./<story-id>` |
| `--genre <name>` | `genre` in `story.md` | `fiction`, or inherited from a linked book |
| `--sub-genre <name>` | `sub-genre` | `general`, or inherited |
| `--setting-era <name>` | `setting-era` | `unspecified` |
| `--theme <name>` | Add a theme; repeatable | `change` |
| `--themes <a,b>` | Add comma-separated themes | |
| `--pov <style>` | `pov` | `third-person-limited`, or inherited |
| `--tense <tense>` | `tense`: `past`, `present`, `future`, or `mixed` | `past`, or inherited |
| `--synopsis <text>` | Text of the `## Synopsis` section | `Add a 2-3 sentence synopsis here.` |
| `--series <id>` | Kebab-case series id | Inherited from a linked book |
| `--book-number <n>` | Publication order, a positive integer | With `--follows` or `--precedes`, one more than the highest number in the linked series; otherwise unset |
| `--follows <path>` | This book is set after the story at `<path>`; repeatable | |
| `--precedes <path>` | This book is set before the story at `<path>`; repeatable | |
| `--force` | Use an existing directory: add missing starter files, never overwrite existing ones | Off |

Without `--force`, `init` refuses an existing directory:

```shell
story init "The Salt Road"
```

```text
~/stories/the-salt-road already exists. Use --force to add missing starter files; existing files are never overwritten.
```

Example:

```shell
cd ~/stories
story init "The Salt Road" --genre fantasy --sub-genre "coastal adventure" --theme loyalty --theme memory
```

```text
Created story project: ~/stories/the-salt-road
```

`--follows` and `--precedes` start a linked sequel or prequel. The new book inherits the linked book's series id, genre, sub-genre, POV, and tense unless you override them, and `init` writes the matching backlink into the other book's `story.md`:

```shell
story init "Embers Rekindled" --follows the-last-ember
```

```text
Created story project: ~/stories/embers-rekindled
Linked series backlink in ~/stories/the-last-ember/story.md
```

See [Series](series.md) for how linked books are ordered and checked, and [Getting started](getting-started.md) for what to do after `init`.

### import

```text
story import <source> --title <name> [options]
```

Creates a new project from an existing manuscript. `<source>` is a single `.md`, `.markdown`, or `.txt` file, or a directory of them. `--title` is required.

- A file with `Chapter` headings (any heading level, with arabic or roman numerals, or none) is split at each heading. Text before the first chapter heading becomes a chapter titled `Opening`.
- A file without chapter headings becomes one chapter, titled by its first `#` heading or by its file name.
- A directory is imported in natural file-name order (`chapter-2` before `chapter-10`). Files with no number in their name come after the numbered ones, except prologue, preface, foreword, introduction, and prelude files, which come first. Symlinks are never followed; a symlink to a document is refused.
- Leading YAML frontmatter in source files is dropped.

Each chapter is written to `chapters/chapter-NN.md` with `status: draft` and its word count, and the registries are rebuilt. `import` then prints up to 25 capitalised names that appear three or more times, as candidates for `story add character` or `story add location`.

`import` accepts `--dir`, `--genre`, `--sub-genre`, `--setting-era`, `--theme`, `--themes`, `--pov`, `--tense`, `--synopsis`, and `--force`, with the same meaning as for `init`. It does not accept the series options. Without `--synopsis`, the synopsis placeholder names the source file.

> [!WARNING]
> With `--force` on an existing directory, `import` deletes every `chapter-NN.md` in `chapters/` before writing the imported chapters, and the frontmatter you filled in on those chapters is lost. Commit or back up the project first.

Given a draft with a `# The Lost Coast` title, a short note, and three `## Chapter` headings, the note becomes an `Opening` chapter, so four chapters are written:

```shell
story import lost-coast-draft.md --title "The Lost Coast" --genre mystery
```

```text
Imported 4 chapters (66 words) into ~/stories/the-lost-coast
Entity candidates (review, then create with story add):
- Tamsin Ashe (4 mentions)
- Captain Aldous Vane (3 mentions)
```

See [Import, export, and builds](manuscripts.md) for the full import workflow.

### migrate

```text
story migrate [path]
```

Upgrades a project to the current schema (version 2). It creates any missing v2 directories and starter files (`scenes/`, `continuity/state.md` and the question, promise, and clue ledgers, `glossary/`, and the `worldbuilding/factions/` and `worldbuilding/artifacts/` folders), sets `schema-version: 2` in `story.md`, and runs `reindex`. Existing files are never overwritten. Running it on a current project changes nothing.

On a copy of a project with `schema-version: 1` and no clue ledger or glossary:

```text
$ story validate
Project validation failed: 4 errors, 0 warnings, 0 dismissed
error: Missing required path: continuity/clues/_index.md
error: Missing required path: continuity/clues
error: Missing required path: glossary/_index.md
error: Missing required path: glossary/terms

$ story migrate
Migrated project to current schema: 5 changes

$ story validate
Project is valid: 0 errors, 0 warnings, 0 dismissed
```

On a project that is already current:

```text
Project already uses the current schema
```

## Maintenance commands

Run these after any change to story files. The usual sequence after an editing session is:

```shell
story wordcount . --write
story reindex .
story links .
story validate .
story continuity .
```

`wordcount --write` comes first because it rewrites chapter frontmatter and then reindexes, so the registries reflect the new counts before the checks run.

### validate

```text
story validate [path]
```

Checks that the project is structurally sound:

- every required file and directory exists
- every markdown file's YAML frontmatter parses, and required fields are present with valid values and types
- entity ids are kebab-case and enum fields (roles, statuses, types) use allowed values
- each registry `_index.md` links every entity file (warning)
- declared chapter `word-count` values match the prose (warning)
- each chapter has at least one scene record (warning)
- matter pages have text; research marked `verified` lists sources; research that is still `open` or `disputed` is not relied on by a `final` or `complete` chapter; no stray `.md` files sit at the project root or nested inside entity directories (warnings)
- `style-sheet.md`, `progress.md`, `continuity/exemptions.md`, and the `story.md` `cover` image are well formed, when present

Errors exit 1; warnings alone exit 0.

After hand-writing `characters/old-bram.md` with `locations: dock-nine` (a string, not a list) in a project with an empty acknowledgments page:

```shell
story validate
```

```text
Project validation failed: 1 errors, 2 warnings, 0 dismissed
error: characters/old-bram.md frontmatter field locations must be a list
warning: matter/acknowledgments.md has no text and is left out of export and build
warning: characters/_index.md is missing registry link ](old-bram.md)
```

A clean project:

```text
Project is valid: 0 errors, 0 warnings, 0 dismissed
```

The field rules are in the [Project format reference](project-format.md).

### reindex

```text
story reindex [path]
```

Rebuilds every registry table from the entity files on disk: `characters/_index.md`, `worldbuilding/_index.md`, `plot/_index.md`, `chapters/_index.md`, `scenes/_index.md`, the question, promise, and clue registries under `continuity/`, and `glossary/_index.md`. It also rebuilds `matter/_index.md` and `research/_index.md` when those folders exist, and sets the `story` field in `plot/timeline.md` and `continuity/state.md` to the current story id.

Hand-written sections of the registries survive a reindex: `## Relationship Map` and `## Family Trees` in the character registry, `## World Overview` in the world registry, and `## Story Structure`, `## Theme Tracking`, and the `structure` field in the plot registry. Files whose content would not change are not rewritten.

Run it after you create, rename, or delete an entity file by hand. `add`, `rename`, `remove`, `migrate`, and `wordcount --write` reindex for you.

```shell
story reindex
```

```text
Updated 1 registries
```

```shell
story reindex
```

```text
Registries already up to date
```

### wordcount

```text
story wordcount [path] [--write]
```

Counts the prose words in each chapter and prints a total. Only the chapter's prose counts: the text after `## Chapter Text`; failing that, the text after the first `---` divider below `## Outline` (or everything after `## Outline` if there is no divider); failing that, the body without its leading `#` heading. Inline and fenced code, images, link targets, and markdown symbols are ignored; hyphenated words and contractions count once.

| Option | Effect |
|---|---|
| `--write` | Write each changed count into the chapter's `word-count` frontmatter, then reindex so `chapters/_index.md` shows the new totals |

On a copy of [`examples/the-unraveled-thread`](../examples/the-unraveled-thread/) after adding a 20-word paragraph to chapter 3:

```text
$ story validate
Project is valid: 0 errors, 1 warnings, 0 dismissed
warning: chapters/chapter-03.md declares 24 words but contains 44

$ story wordcount --write
chapters/chapter-01.md: 34
chapters/chapter-02.md: 31
chapters/chapter-03.md: 44
chapters/chapter-04.md: 22
Total: 131
```

Without `--write`, the same counts are printed and nothing changes.

### links

```text
story links [path]
```

Checks that references between entities point at entities that exist and that two-way links are mirrored. It covers:

- character relationships, which need a backlink of the matching inverse type (`mentor` and `student`, `sibling` and `sibling`)
- character `locations` and location `notable-characters`, which must list each other
- a character's `died-in` chapter
- arc characters, faction members and locations, and artifact owners and locations
- chapter and scene POV, `characters`, `mentions` (a character or an artifact), locations, and `arcs-advanced`, and each scene's chapter
- the chapter, character, and arc ids in questions, promises, and clues, and the `used-in` chapters of research notes
- chapter ids and markdown links in the bodies of `plot/timeline.md` and arc files
- the `follows` and `precedes` links in `story.md`, which must point at story projects that link back

With `characters/old-bram.md` listing `locations: [dock-nine, gull-harbour]`, where `dock-nine` does not exist and `gull-harbour` does not list Bram back:

```shell
story links
```

```text
Link check failed: 2 errors, 0 warnings, 0 dismissed
error: characters/old-bram.md references missing location dock-nine
error: characters/old-bram.md location gull-harbour is missing notable-character backlink
```

```shell
story links
```

```text
Links are valid: 0 errors, 0 warnings, 0 dismissed
```

The linking rules are in [Core concepts](concepts.md#links-and-backlinks) and the [Project format reference](project-format.md#references-and-backlinks).

## Analysis commands

These commands read the project and never change story files. The one exception is `progress --log`, which writes only its own session log, `progress.md`.

### continuity

```text
story continuity [path]
```

Runs the deterministic continuity engine over frontmatter: characters appearing after they die, promises and clues paid off before they are planted, questions resolved before they are introduced, planted setups with no payoff, POV characters missing from a chapter's cast, destroyed or lost artifacts used later, impossible clock and travel times, and references in `continuity/state.md`. Findings matching an entry in `continuity/exemptions.md` are reported as `dismissed` and do not fail the run.

Using a copy of [`examples/the-unraveled-thread`](../examples/the-unraveled-thread/), which is broken on purpose:

```shell
story continuity
```

```text
Continuity check failed: 4 errors, 3 warnings, 0 dismissed
error: chapters/chapter-04.md lists edran-vale, who died in chapter-02; move posthumous appearances to mentions
error: continuity/promises/the-broken-compass.md pays off in chapter-02 before it is planted in chapter-03
error: continuity/questions/who-burned-the-mill.md resolves in chapter-02 before it is introduced in chapter-03
error: continuity/state.md knowledge-state[0] references missing chapter chapter-05
warning: chapters/chapter-03.md POV character nessa-thorn is not listed in characters
warning: continuity/promises/the-sealed-letter.md was planted in chapter-01, 3 chapters ago, and has no payoff yet
warning: continuity/state.md object-state[0] status active conflicts with worldbuilding/artifacts/vales-compass.md status destroyed
```

Every rule, and how to write exemptions, is in [Continuity and analysis](continuity.md#story-continuity).

### knowledge

```text
story knowledge <character-id> --at <chapter-id> [--path <project>]
```

Lists the `knowledge-state` entries in `continuity/state.md` that a character knew by a given chapter. An entry counts if its `learned-in` chapter is at or before `--at`; an entry with no `learned-in` is pre-existing knowledge and always counts.

| Option | Effect |
|---|---|
| `--at <chapter-id>` | Required. The chapter to ask about |
| `--path <path>` | Project root (default: current directory) |

In [`examples/harbor-of-second-light`](../examples/harbor-of-second-light/):

```shell
story knowledge mara-quill --at chapter-01
```

```text
- the Afterimage Archive was active during the Blackout Night (learned in chapter-01)
```

In [`examples/the-last-ember`](../examples/the-last-ember/):

```shell
story knowledge kael-voss --at chapter-01
```

```text
- The tunnels from the Vale side reach the Whisper Gate into the High Keep (pre-existing knowledge)
```

With nothing recorded, it prints `No recorded knowledge for <id> at <chapter-id>` and exits 0. A missing argument, or an unknown character or chapter, exits 1:

```text
$ story knowledge kael-voss
Usage: story knowledge <character-id> --at <chapter-id> [--path <project>]

$ story knowledge nobody --at chapter-01
Unknown character nobody

$ story knowledge kael-voss --at chapter-09
Unknown chapter chapter-09
```

### compare

```text
story compare [path] (--ref <git-ref> | --against <path>)
```

Compares the current chapters with an earlier draft and reports word changes per chapter, chapters added and removed, and the share of each changed chapter's paragraphs that are unchanged. You must give exactly one source for the earlier draft.

| Option | Effect |
|---|---|
| `--ref <git-ref>` | Read the earlier chapters from a git branch, tag, or commit (with `~` and `^` suffixes). The project must be inside a git repository. It reads with `git show` and never writes to the repository |
| `--against <path>` | Read the earlier chapters from another copy of the project on disk, resolved against the current directory. It must be a story project with a `story.md` |

Chapters are matched by id (`chapter-01`, `chapter-02`, and so on). Old drafts without frontmatter are still compared.

With `../thread-draft-1` a copy of the project taken before the chapter 3 edit shown under [wordcount](#wordcount):

```shell
story compare --against ../thread-draft-1
```

```text
Compared with ~/stories/thread-draft-1
Chapters: 4 then, 4 now (0 added, 0 removed)
Words: 111 then, 131 now (+20)

- chapter-01 The Ledger in the Ash: unchanged (34 words)
- chapter-02 The Millpond: unchanged (31 words)
- chapter-03 The Dry Side of Mill Row: 24 -> 44 words (+20), 50% of paragraphs unchanged
- chapter-04 The Lock Gate: unchanged (22 words)
Comparison complete: 0 errors, 0 warnings, 0 dismissed
```

Against a git tag, run from a clone of this repository:

```shell
story compare examples/the-last-ember --ref v0.8.0
```

```text
Compared with git ref v0.8.0
Chapters: 1 then, 1 now (0 added, 0 removed)
Words: 993 then, 993 now (±0)

- chapter-01 The Ember Wakes: unchanged (993 words)
Comparison complete: 0 errors, 0 warnings, 0 dismissed
```

Errors:

```text
$ story compare
compare needs exactly one of --ref <git-ref> or --against <project-path>

$ story compare --ref main
compare --ref needs the project inside a git repository

$ story compare examples/the-last-ember --ref no-such-tag
Unknown git ref: no-such-tag
```

### progress

```text
story progress [path] [--log] [--date <YYYY-MM-DD>]
```

Reports the manuscript word count against `target-words` in `story.md`, the days left to `deadline` and the words a day needed to meet it, per-chapter `target-words`, and pace from the session log in `progress.md`.

| Option | Effect |
|---|---|
| `--log` | Record today's total word count in `progress.md`, creating the file if needed. A second log on the same date replaces the first |
| `--date <YYYY-MM-DD>` | Use this date as "today", for the deadline and for `--log`. Default: the local date |

`--log` refuses to rewrite a `progress.md` that does not parse or has malformed sessions, and names each problem.

With `target-words: 90000` and `deadline: 2027-03-31` in `story.md`:

```shell
story progress --log --date 2026-09-20
```

```text
Logged 993 words for 2026-09-20 in ~/stories/the-last-ember/progress.md
Progress: 993 of 90,000 words (1.1%)
Remaining: 89,007 words
Deadline: 2027-03-31 (192 days left): 464 words a day needed
Sessions: 1 logged; last 2026-09-20 (+0 words since)
Progress checked: 0 errors, 0 warnings, 0 dismissed
```

Without a target:

```shell
story progress
```

```text
Progress: 993 words (no target-words in story.md)
Sessions: none logged (run story progress --log after a writing session)
Progress checked: 0 errors, 0 warnings, 0 dismissed
```

### timeline

```text
story timeline [path]
```

Shows three read-only views:

- **Chronology**: scenes (and chapters with no scene records) that have a `date` in story order, sorted by `date` and then `time`. An entry told after events that happen later in story time is marked `[told in chapter N, after later events]`. Undated entries are listed separately in reading order.
- **POV balance**: chapters and words per POV character.
- **Character presence**: how many chapters each character appears in, their longest absence, and whether they drop out before the end.

`timeline` reports no findings of its own; clock errors belong to `continuity`.

In the Salt Road project (see [Example projects used on this page](#example-projects-used-on-this-page)), after adding a second chapter with a flashback scene dated twelve years earlier:

```shell
story timeline
```

```text
Timeline: 3 dated, 0 undated

Chronology (story order):
- 1012-11-08 night  chapter-02-scene-01: Twelve Years Earlier (POV ilse-varrow, at gull-harbour) [told in chapter 2, after later events]
- 1024-03-02 06:30  chapter-01-scene-01: The Harbour Bell (POV ilse-varrow, at gull-harbour)
- 1024-03-02 evening  chapter-02-scene-02: Back on the Quay (POV ilse-varrow, at gull-harbour)

POV balance:
- ilse-varrow: 2 chapters, 0 words (0%)

Character presence:
- ilse-varrow: 2 of 2 chapters, chapters 1-2
Timeline built: 0 errors, 0 warnings, 0 dismissed
```

### prose

```text
story prose [path]
```

An advisory prose lint. For each chapter it reports sentence count, average and longest sentence length and their spread, filter words and `-ly` adverbs per 1,000 narration words, dialogue tags and said-bookisms, words echoed within 30 words, and watch words and avoided spellings from `style-sheet.md`. Across the manuscript it lists repeated four-word phrases and characters with similar first names.

Findings are warnings, so `prose` exits 0 on any readable project.

```shell
story prose
```

```text
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

See [Continuity and analysis](continuity.md#story-prose) for the rules and the [voice-style skill](../skills/voice-style/SKILL.md) for acting on them.

### series

```text
story series [path]
```

Follows the `follows` and `precedes` links in `story.md` to every connected book, orders them by story chronology, and checks canon shared between them: characters who died in an earlier book but are alive or cast in a later one, facts a character relearns after knowing them in an earlier book, and (as warnings) name drift and artifacts destroyed in an earlier book. It also reports link problems: a linked folder without `story.md`, books in different series, a chronology cycle, or two books with the same `book-number`. Any error exits 1. Missing backlinks are reported by `story links`, not `story series`.

Using copies of [`examples/the-last-ember`](../examples/the-last-ember/) and [`examples/the-fall-of-the-citadel`](../examples/the-fall-of-the-citadel/), which are linked:

```shell
story series
```

```text
# Series: the-ember-cycle

Chronological order:
1. The Fall of the Citadel (book 2, planning) - ../the-fall-of-the-citadel
2. The Last Ember (book 1, in-progress) - .

Shared canon:
- Characters: kael-voss, lord-maren, sera-voss
- Locations: ashen-citadel
- Systems: ember-magic
- Facts: whisper-gate-route

Series is consistent: 0 errors, 0 warnings, 0 dismissed
```

On a standalone book it reports a one-book series and exits 0:

```shell
story series
```

```text
# Series: Unnamed series

Chronological order:
1. The Unraveled Thread (unnumbered, drafting) - .

Shared canon:
- None

Series is consistent: 0 errors, 0 warnings, 0 dismissed
```

See [Series](series.md).

### report

```text
story report [path] [--actionable]
```

Prints a project summary: metadata, entity counts, total words (and percentage of `target-words`, when set), a line per chapter and arc, and the result of `validate`, `links`, and `continuity`.

| Option | Effect |
|---|---|
| `--actionable` | Append the prioritised actions that `next` would print |

```shell
story report --actionable
```

```text
# The Last Ember

Story ID: the-last-ember
Schema version: 2
Series: the-ember-cycle (book 1)
Status: in-progress
Genre: fantasy / epic
POV/Tense: third-person-limited / past

Inventory:
- Characters: 3
- Locations: 2
- Systems: 1
- Factions: 1
- Artifacts: 1
- Arcs: 1
- Chapters: 1
- Scenes: 1
- Questions: 0
- Promises: 0
- Clues: 0
- Glossary terms: 1
- Total words: 993

Chapters:
- 1. The Ember Wakes (draft, 993 words, POV: sera-voss)

Arcs:
- Sera's Reclamation (main, in-progress, 3 characters)

Checks:
- Validate: ok (0 errors, 0 warnings)
- Links: ok (0 errors, 0 warnings)
- Continuity: ok (0 errors, 0 warnings)

Next Actions:
- [P3] Project is mechanically healthy: No deterministic maintenance issues are blocking the next writing pass.
- [P2] Draft chapter 2: Use story add chapter "Chapter 2" --number 2, then outline scenes to advance Sera's Reclamation.
```

`report` always exits 0 on a readable project.

### next

```text
story next [path]
```

Runs `validate`, `links`, and `continuity`, then lists prioritised actions:

| Priority | Actions |
|---|---|
| `P0` | Fix validation errors, broken references, or continuity contradictions |
| `P1` | Review continuity warnings, refresh stale word counts, add scene records for chapters without them |
| `P2` | Track open questions, review pending promises and open clues, draft the next chapter, create a first character |
| `P3` | Nothing is blocking the next writing pass |

Always exits 0 on a readable project.

```shell
story next
```

```text
# Next Writing Actions: The Unraveled Thread

Checks: validate ok (0 errors, 0 warnings), links ok (0 errors, 0 warnings), continuity failed (4 errors, 3 warnings)

Actions:
- [P0] Fix continuity contradictions: Run story continuity . and repair 4 deterministic continuity errors.
- [P1] Review continuity warnings: Run story continuity . and review 3 continuity warnings.
- [P2] Review promises and payoffs: 1 setup/payoff promises need planting or payoff decisions.
- [P2] Draft chapter 5: Use story add chapter "Chapter 5" --number 5, then outline scenes to advance The Ledger Trail.
```

### doctor

```text
story doctor [path]
```

The same checks and actions as `next`, laid out as a health report with the project root and one line per check. Use it when you want to know what is stale or broken. Always exits 0 on a readable project.

```shell
story doctor
```

```text
# Story Doctor: The Unraveled Thread

Root: ~/stories/the-unraveled-thread

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

## Entity commands

`add`, `rename`, and `remove` take the project from `--path` (default: the current directory), because their positional arguments are the entity kind, id, and name. Each one reindexes the registries when it finishes.

### Entity kinds

| Kind | Accepted spellings | Directory | Id comes from |
|---|---|---|---|
| `character` | `character`, `characters` | `characters/` | The name, in kebab-case |
| `location` | `location`, `locations` | `worldbuilding/locations/` | The name |
| `system` | `system`, `systems` | `worldbuilding/systems/` | The name |
| `faction` | `faction`, `factions` | `worldbuilding/factions/` | The name |
| `artifact` | `artifact`, `artifacts` | `worldbuilding/artifacts/` | The name |
| `arc` | `arc`, `arcs` | `plot/arcs/` | The name |
| `chapter` | `chapter`, `chapters` | `chapters/` | The number: `chapter-NN` |
| `scene` | `scene`, `scenes` | `scenes/` | Chapter and number: `chapter-NN-scene-NN` |
| `question` | `question`, `questions` | `continuity/questions/` | The title |
| `promise` | `promise`, `promises` | `continuity/promises/` | The title |
| `clue` | `clue`, `clues` | `continuity/clues/` | The title |
| `term` | `term`, `terms`, `glossary`, `glossary-term`, `glossary-terms` | `glossary/terms/` | The term |
| `matter` | `matter` | `matter/` | The title |
| `research` | `research`, `research-note`, `research-notes` | `research/` | The title |

Kinds are case-insensitive. Ids are lowercase kebab-case: accents are stripped, apostrophes dropped, and every other run of non-alphanumeric characters becomes a hyphen, so `Sera's Reclamation` becomes `seras-reclamation`.

### add

```text
story add <kind> <name> [options] [--path <project>]
```

Creates an entity file with starter frontmatter and body sections, then reindexes. It refuses to overwrite an existing file. Options that do not apply to the kind are ignored.

For characters and locations, `add` also writes the backlink on the other side: adding a character with `--location gull-harbour` appends the character to that location's `notable-characters`, and adding a location with `--character` appends the location to each character's `locations`.

Options by kind:

| Kind | Options (frontmatter field) | Defaults |
|---|---|---|
| `character` | `--role` (`role`), `--status` (`status`), `--location` (`locations`), `--arc` (`arc`: one free-text theme label such as `redemption`, not an arc id; give it once) | `supporting`, `alive` |
| `location` | `--type`, `--status`, `--region`, `--population`, `--controlled-by`, `--character` (`notable-characters`) | `other`, `unknown` |
| `system` | `--type`, `--prevalence` | `other`, `uncommon` |
| `faction` | `--type`, `--status`, `--member` (`members`; `--character` also works), `--location` (`locations`) | `other`, `active` |
| `artifact` | `--type`, `--status`, `--owner` (`owner`), `--location` (`location`, a single id; give it once) | `object`, `active` |
| `arc` | `--type`, `--status`, `--character` (`characters`), `--theme`/`--themes` (`themes`), `--acts` (`acts`) | `subplot`, `planned` |
| `chapter` | `--number`, `--pov`, `--location` (`locations`), `--character` (`characters`), `--mention` (`mentions`), `--arc` (`arcs-advanced`), `--status`, `--mode`, `--date`, `--time` | Next free number, `outline` |
| `scene` | `--chapter`, `--scene`, `--pov`, `--location` (`location`, a single id; give it once), `--character` (`characters`), `--mention` (`mentions`), `--arc` (`arcs-advanced`), `--status`, `--date`, `--time`, `--travel-hours`, `--sequel`, `--dilemma` | Latest chapter, next free scene number, `outline` |
| `question` | `--status`, `--introduced`, `--resolved`, `--character` (`characters`) | `open` |
| `promise` | `--status`, `--planted`, `--payoff`, `--arc` (`arcs`), `--character` (`characters`) | `planted` with `--planted`, otherwise `planned` |
| `clue` | `--status`, `--planted`, `--payoff`, `--significance-delayed`, `--character` (`characters`), `--arc` (`arcs`) | `planted` with `--planted`, otherwise `planned` |
| `term` | `--category`, `--alias` (`aliases`) | `term` |
| `research` | `--status`, `--source` (`sources`), `--used-in` (`used-in`) | `open` |
| `matter` | `--placement`, `--order` | `front`, next order in that placement |

`add` checks enum values before writing anything:

| Field | Allowed values |
|---|---|
| character `--role` | `protagonist`, `antagonist`, `supporting`, `minor`, `narrator`, `deuteragonist` |
| character `--status` | `alive`, `deceased`, `unknown`, `missing`, `cut` |
| faction `--type` | `family`, `guild`, `government`, `military`, `religion`, `company`, `community`, `criminal`, `other` |
| faction `--status` | `active`, `hidden`, `declining`, `defeated`, `disbanded`, `unknown` |
| artifact `--type` | `object`, `weapon`, `document`, `technology`, `relic`, `symbol`, `resource`, `other` |
| artifact `--status` | `active`, `lost`, `destroyed`, `hidden`, `transferred`, `unknown` |
| arc `--type` | `main`, `subplot`, `character`, `thematic` |
| arc `--status` | `planned`, `in-progress`, `resolved` |
| chapter and scene `--status` | `outline`, `draft`, `revised`, `final`, `complete` |
| question `--status` | `open`, `answered`, `resolved`, `dropped`, `abandoned` |
| promise and clue `--status` | `planned`, `planted`, `paid-off`, `dropped`, `abandoned` |
| term `--category` | `person`, `place`, `faction`, `artifact`, `concept`, `term`, `other` |
| research `--status` | `open`, `verified`, `disputed` |
| matter `--placement` | `front`, `back` |

Location and system `--type`, location `--status`, and system `--prevalence` are free text. `--date` must be a real `YYYY-MM-DD` day; `--time` is `HH:MM` or one of `dawn`, `morning`, `midday`, `afternoon`, `evening`, `night`; `--travel-hours` is a number zero or above; `--number` and `--scene` are positive integers; `--order` is a non-negative integer. Repeating a single-value flag writes a list that `story validate` rejects.

`--source` keeps each value whole, because citations contain commas. Repeat the flag for more sources. Other list options split on commas.

Examples, run in The Salt Road:

```text
$ story add location "Gull Harbour" --type port --region "the Shallows"
Created location gull-harbour: ~/stories/the-salt-road/worldbuilding/locations/gull-harbour.md

$ story add character "Ilse Marrow" --role protagonist --location gull-harbour
Created character ilse-marrow: ~/stories/the-salt-road/characters/ilse-marrow.md

$ story add arc "The Long Crossing" --type main --character ilse-marrow --themes loyalty,memory --acts act-1,act-2
Created arc the-long-crossing: ~/stories/the-salt-road/plot/arcs/the-long-crossing.md

$ story add chapter "Low Tide" --pov ilse-marrow --character ilse-marrow --location gull-harbour --arc the-long-crossing --date 1024-03-02 --time dawn
Created chapter chapter-01: ~/stories/the-salt-road/chapters/chapter-01.md

$ story add scene "The Harbour Bell" --chapter chapter-01 --pov ilse-marrow --location gull-harbour --character ilse-marrow --date 1024-03-02 --time 06:30
Created scene chapter-01-scene-01: ~/stories/the-salt-road/scenes/chapter-01-scene-01.md

$ story add clue "Tar on the chain" --planted chapter-01 --significance-delayed
Created clue tar-on-the-chain: ~/stories/the-salt-road/continuity/clues/tar-on-the-chain.md

$ story add term "Slack water" --category concept --alias slack --alias "the turn"
Created term slack-water: ~/stories/the-salt-road/glossary/terms/slack-water.md

$ story add research "Tidal bore timing" --source "Admiralty Tide Tables, 2024 edition" --used-in chapter-01
Created research tidal-bore-timing: ~/stories/the-salt-road/research/tidal-bore-timing.md

$ story add matter "Acknowledgments" --placement back
Created matter acknowledgments: ~/stories/the-salt-road/matter/acknowledgments.md
```

The location file after the character was added shows the backlink `add` wrote:

```yaml
---
name: Gull Harbour
type: port
region: the Shallows
population: ""
controlled-by: ""
notable-characters:
  - ilse-marrow
tags: []
status: unknown
---
```

An invalid enum value stops before anything is written:

```shell
story add character "Tobin Reyes" --role wizard
```

```text
Unsupported character role "wizard": expected one of protagonist, antagonist, supporting, minor, narrator, deuteragonist
```

Fill in the body sections by hand, or ask an agent to, after `add`. For what each field means, see the [Project format reference](project-format.md).

### rename

```text
story rename <kind> <id> <new name> [--path <project>]
```

Sets the entity's name or title and, when the new name gives a different id, renames the file and rewrites every reference to the old id. References are the id-valued frontmatter fields (such as `characters`, `pov`, `locations`, `owner`, `planted`, `learned-in`, and the entries in `continuity/state.md`) and markdown links that resolve to the entity's file. Prose is never changed, so update names in the chapter text yourself.

Chapter and scene ids come from their numbers, so renaming one changes only its title.

Every rewrite is planned before anything is written, so a file that fails to parse leaves the project unchanged. `rename` refuses if an entity with the new id already exists.

```text
$ story rename character ilse-marrow "Ilse Varrow"
Renamed character ilse-marrow to ilse-varrow: ~/stories/the-salt-road/characters/ilse-varrow.md

$ story rename chapter chapter-01 "Slack Water"
Renamed chapter chapter-01 to chapter-01: ~/stories/the-salt-road/chapters/chapter-01.md
```

### remove

```text
story remove <kind> <id> [--path <project>]
```

Deletes the entity file and scrubs its id from every reference field. List entries are removed, single-value fields are cleared, and whole entries in `relationships`, `character-state`, `knowledge-state`, and `object-state` are dropped when they are about the removed entity. Prose and markdown links in file bodies are never changed, so `story links` reports any body link that now points at a missing file. As with `rename`, every file is parsed before anything is deleted, so a file that fails to parse leaves the project unchanged.

```text
$ story remove artifact brass-sounding-line
Removed artifact brass-sounding-line: ~/stories/the-salt-road/worldbuilding/artifacts/brass-sounding-line.md

$ story remove artifact brass-sounding-line
artifact brass-sounding-line does not exist
```

Run `story links` and `story validate` after `rename` or `remove` to confirm nothing else needs attention.

## Output commands

These commands produce files for reading or submission. The source of truth stays in the chapter files; regenerate outputs whenever you need them. See [Import, export, and builds](manuscripts.md) for formats, front and back matter, and covers.

### export

```text
story export [path] [--out <file>]
```

Writes one markdown manuscript: the story title, front matter pages, every chapter as `# Chapter N: Title` followed by its prose, then back matter pages. Only chapter prose is included, not outlines or notes. Matter pages with no text are left out.

| Option | Effect | Default |
|---|---|---|
| `--out <file>` | Output path, relative to the project root | `manuscript.md` |

```text
$ story export
Exported 1 chapters to ~/stories/the-last-ember/manuscript.md

$ story export --out drafts/manuscript.md
Exported 1 chapters to ~/stories/the-last-ember/drafts/manuscript.md
```

A manuscript written to the project root is not part of the project model, so `validate` warns about it:

```text
warning: manuscript.md is not part of the story project model and is ignored
```

Prefer `build`, which writes to `dist/`, when you do not need a specific path. `export` fails with `No chapters found to export` on a project without chapters, and, like `build`, refuses two chapters with the same number or a matter file whose name is not kebab-case.

> [!WARNING]
> `export` does not validate the project first, and a chapter file whose frontmatter cannot be parsed is silently left out of the manuscript. Run `story validate` before you export a copy to send anyone.

### build

```text
story build [path] [--format <name>] [--shunn] [--out <file>]
```

Builds a disposable book file in `dist/`. Builds are deterministic: the same sources give byte-identical output. EPUB timestamps use `SOURCE_DATE_EPOCH` when it is set and a fixed date otherwise.

| Option | Effect | Default |
|---|---|---|
| `--format <name>` | `markdown` (or `md`), `epub`, `docx`, or `shunn` | `markdown` |
| `--shunn` | With `--format docx`, apply Shunn manuscript formatting. Ignored for other formats | Off |
| `--out <file>` | Output path, relative to the project root | `dist/<story-id>.<ext>` |

| Format | Default output | Contents |
|---|---|---|
| `markdown` | `dist/<story-id>.md` | The same manuscript as `export` |
| `epub` | `dist/<story-id>.epub` | EPUB 3 with a navigation document, front and back matter, `author` from `story.md` as creator, and the `cover` image from `story.md` when set |
| `docx` | `dist/<story-id>.docx` | Word document with headings and paragraphs |
| `docx` with `--shunn` | `dist/<story-id>.docx` | Shunn format: Courier New 12pt, double-spaced, title page |
| `shunn` | `dist/<story-id>.shunn.md` | Shunn manuscript markdown: title, byline, approximate word count, `contact` lines, page breaks between chapters |

```text
$ story build
Built 1 chapters as markdown to ~/stories/the-last-ember/dist/the-last-ember.md

$ story build --format epub
Built 1 chapters as epub to ~/stories/the-last-ember/dist/the-last-ember.epub

$ story build --format docx
Built 1 chapters as docx to ~/stories/the-last-ember/dist/the-last-ember.docx

$ story build --format docx --shunn --out dist/submission.docx
Built 1 chapters as docx to ~/stories/the-last-ember/dist/submission.docx

$ story build --format shunn
Built 1 chapters as shunn to ~/stories/the-last-ember/dist/the-last-ember.shunn.md

$ story build --format pdf
Unsupported build format: pdf. Supported formats: markdown, epub, docx, shunn
```

`build` refuses a project with no chapters, two chapters with the same number, or a matter file whose name is not kebab-case. A `cover` that is missing, outside the project, or not a `.gif`, `.jpeg`, `.jpg`, `.png`, or `.webp` image fails the EPUB build and `validate`. Keep `dist/` out of version control.

> [!WARNING]
> Like `export`, `build` does not validate the project first and silently leaves out any chapter whose frontmatter cannot be parsed. Run `story validate` before you build a copy to send anyone.

### synopsis

```text
story synopsis [path] [--pages 1|3] [--out <file>]
```

Builds a mechanical synopsis from the project: a premise (the first sentence of the `## Synopsis` section in `story.md`), then for each arc up to two sentences from `## Setup`, up to two from `## Rising Action`, and a line starting `Because` that joins the first sentence of `## Climax` and of `## Resolution`. If the text exceeds the page budget, it drops rising action, then resolution, then truncates with an ellipsis.

| Option | Effect | Default |
|---|---|---|
| `--pages <n>` | `1` (500-word budget) or `3` (1,500-word budget) | `1` |
| `--out <file>` | Write to this path, relative to the project root, instead of stdout | Print to stdout |

```shell
story synopsis
```

```text
# Synopsis: The Last Ember

Premise: In a world where magic flows from living embers — fragments of a dying god's heart — Sera Voss returns to the Ashen Citadel to reclaim her birthright from Lord Maren, the usurper who murdered her parents and seized control of the Northern Reach.

## Sera's Reclamation

Sera and Kael have survived twelve years in the Whispering Vale.  The embers are fading — even in the Vale, the wild motes grow dimmer each season.

Sera gathers information, allies, and ember power.  She discovers the ember well beneath the citadel isn't just sealed — it's being drained.

Because Sera infiltrates the citadel through the Whisper Gate. Sera chooses to unseal the ember well and release its power back into the land rather than claim it.
```

```text
$ story synopsis --pages 3 --out dist/synopsis.md
Wrote synopsis to ~/stories/the-last-ember/dist/synopsis.md

$ story synopsis --pages 2
Unsupported synopsis length: 2. Supported pages: 1, 3
```

The output is a scaffold. The [submission skill](../skills/submission/SKILL.md) turns it into a synopsis ready to send to agents.

## Option index

Every option the CLI accepts, in the order `story --help` lists them. "Repeatable" options collect every value; for the rest, the last value wins.

| Option | Value | Used by | Notes |
|---|---|---|---|
| `--title` | `<name>` | `import` | Required for `import` |
| `--dir` | `<path>` | `init`, `import` | Target directory |
| `--genre` | `<name>` | `init`, `import` | |
| `--sub-genre` | `<name>` | `init`, `import` | |
| `--setting-era` | `<name>` | `init`, `import` | |
| `--theme` | `<name>` | `init`, `import`, `add arc` | Repeatable |
| `--themes` | `<a,b>` | `init`, `import`, `add arc` | Comma-separated; repeatable |
| `--pov` | `<style>` | `init`, `import`, `add chapter`, `add scene` | |
| `--tense` | `<tense>` | `init`, `import` | `past`, `present`, `future`, `mixed` |
| `--synopsis` | `<text>` | `init`, `import` | |
| `--series` | `<id>` | `init` | Kebab-case |
| `--book-number` | `<n>` | `init` | Positive integer |
| `--follows` | `<path>` | `init` | Repeatable |
| `--precedes` | `<path>` | `init` | Repeatable |
| `--force` | | `init`, `import` | Boolean |
| `--write` | | `wordcount` | Boolean |
| `--log` | | `progress` | Boolean |
| `--ref` | `<git-ref>` | `compare` | Exclusive with `--against` |
| `--against` | `<path>` | `compare` | Exclusive with `--ref` |
| `--path` | `<path>` | Every command except `init` and `import` | Project root |
| `--out` | `<file>` | `export`, `build`, `synopsis` | Relative to the project root |
| `--format` | `<name>` | `build` | `markdown`, `md`, `epub`, `docx`, `shunn` |
| `--shunn` | | `build` | Boolean; with `--format docx` |
| `--at` | `<chapter-id>` | `knowledge` | Required for `knowledge` |
| `--pages` | `<n>` | `synopsis` | `1` or `3` |
| `--actionable` | | `report` | Boolean |
| `--number` | `<n>` | `add chapter` | |
| `--chapter` | `<id>` | `add scene` | |
| `--scene` | `<n>` | `add scene` | |
| `--type` | `<name>` | `add location`, `system`, `faction`, `artifact`, `arc` | |
| `--role` | `<name>` | `add character` | |
| `--status` | `<name>` | `add` (most kinds) | |
| `--mode` | `<name>` | `add chapter` | For example `discovered` |
| `--date` | `<date>` | `add chapter`, `add scene`, `progress` | `YYYY-MM-DD` |
| `--time` | `<time>` | `add chapter`, `add scene` | `HH:MM` or a named time of day |
| `--travel-hours` | `<n>` | `add scene` | |
| `--dilemma` | `<text>` | `add scene` | |
| `--sequel` | | `add scene` | Boolean |
| `--location` | `<id>` | `add character`, `faction`, `artifact`, `chapter`, `scene` | Repeatable; alias `--locations`. For `add artifact` and `add scene` it sets one location id: give it once |
| `--character` | `<id>` | `add location`, `faction`, `arc`, `chapter`, `scene`, `question`, `promise`, `clue` | Repeatable; alias `--characters` |
| `--mention` | `<id>` | `add chapter`, `add scene` | Repeatable; alias `--mentions` |
| `--member` | `<id>` | `add faction` | Repeatable; alias `--members` |
| `--owner` | `<id>` | `add artifact` | |
| `--arc` | `<id>` | `add character`, `chapter`, `scene`, `promise`, `clue` | Repeatable; alias `--arcs`. For `add character` it sets the single `arc` theme label: give it once; `--arcs` is ignored there |
| `--introduced` | `<id>` | `add question` | Chapter id |
| `--resolved` | `<id>` | `add question` | Chapter id |
| `--planted` | `<id>` | `add promise`, `add clue` | Chapter id |
| `--payoff` | `<id>` | `add promise`, `add clue` | Chapter id |
| `--significance-delayed` | | `add clue` | Boolean |
| `--category` | `<name>` | `add term` | |
| `--alias` | `<name>` | `add term` | Repeatable; alias `--aliases` |
| `--region` | `<name>` | `add location` | |
| `--population` | `<name>` | `add location` | |
| `--controlled-by` | `<id>` | `add location` | |
| `--prevalence` | `<name>` | `add system` | |
| `--acts` | `<a,b>` | `add arc` | Repeatable; alias `--act` |
| `--placement` | `<front\|back>` | `add matter` | |
| `--order` | `<n>` | `add matter` | |
| `--source` | `<text>` | `add research` | Repeatable, kept whole; alias `--sources` |
| `--used-in` | `<chapter-id>` | `add research` | Repeatable |
| `-h`, `--help` | | Any | Print help |
| `-v`, `--version` | | Any | Print version |

The plural aliases (`--locations`, `--characters`, `--mentions`, `--members`, `--arcs`, `--act`, `--aliases`, `--sources`) are accepted but left out of `--help`.

## The bundled fallback

[`skills/story-maintenance/scripts/story.js`](../skills/story-maintenance/scripts/story.js) is the whole CLI bundled into one file that runs under plain Node 18 or newer, with no install step. It exists for agents that have the skills copied in but not the npm package. The [story-maintenance skill](../skills/story-maintenance/SKILL.md) tells agents to try `story`, then `bun run story --`, then this file.

```shell
node skills/story-maintenance/scripts/story.js --version
```

```text
0.8.2
```

It accepts the same commands and options, and produces the same output, as the package binary. Run it in place; do not copy it into a story project.

The file is generated from `src/` with `bun run build:fallback`, and CI fails if it is out of date (`bun run check:fallback`). See the [Development guide](development.md#the-bundled-fallback) if you change the CLI.

## See also

- [Getting started](getting-started.md): install and first project
- [Project format reference](project-format.md): every file and field the CLI reads
- [Continuity and analysis](continuity.md): the rules behind `continuity`, `prose`, `timeline`, and `knowledge`
- [Import, export, and builds](manuscripts.md): `import`, `export`, `build`, and `synopsis` in depth
- [Automation and CI](automation.md): running checks in GitHub Actions
- [Documentation index](README.md): every page, by audience and task

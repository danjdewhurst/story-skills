# CLI reference

This page lists every command and option of `story`, the deterministic maintenance CLI that ships with Story Skills. Use it when you need a command's exact usage, the options it accepts, what it writes, and how it exits. For what the files mean, see [Project format reference](project-format.md); for where each command fits in a writing session, see [Writing workflows](writing-workflows.md).

The CLI never writes story content for you. It scaffolds files, rebuilds registries, counts words, runs checks, and produces disposable outputs. You and your agent write the prose and story decisions directly in markdown.

**On this page**

- [Running the CLI](#running-the-cli) and the [example projects](#example-projects-used-on-this-page)
- [Command summary](#command-summary)
- [How the CLI behaves](#how-the-cli-behaves)
- [Setup commands](#setup-commands): `init`, `import`, `migrate`
- [Maintenance commands](#maintenance-commands): `validate`, `reindex`, `wordcount`, `links`
- [Analysis commands](#analysis-commands): `continuity`, `knowledge`, `context`, `compare`, `similarity`, `progress`, `timeline`, `prose`, `series`, `report`, `next`, `doctor`
- [Craft and revision commands](#craft-and-revision-commands): `pacing`, `clues`, `voices`, `names`, `diagram`, `passes`
- [Entity commands](#entity-commands): `add`, `rename`, `move`, `remove`
- [Output commands](#output-commands): `export`, `build`, `synopsis`
- [Finding codes](#finding-codes): every error and warning code, by command
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

Most examples run against copies of the sample projects in [`examples/`](../examples/): [`the-last-ember`](../examples/the-last-ember/), [`the-unraveled-thread`](../examples/the-unraveled-thread/) (broken on purpose, for the checks), and [`harbor-of-second-light`](../examples/harbor-of-second-light/). The rest use **The Salt Road**, a new project created with `story init "The Salt Road"` and filled with the commands shown under [add](#add). Its protagonist starts as Ilse Marrow and becomes `ilse-varrow` under [rename](#rename); her home port is `gull-harbour`. Later examples add a second location, `saltmere`, with a route from the harbour (under [continuity](#continuity)), and record revision passes (under [passes](#passes)).

Absolute paths in output are shortened to `~/stories/...`.

## Command summary

| Group | Command | What it does | Writes files |
|---|---|---|---|
| Setup | [`init <title>`](#init) | Scaffold a new story project | Yes |
| | [`import <source\|->`](#import) | Split an existing manuscript, or one piped to stdin, into a new project | Yes |
| | [`migrate [path]`](#migrate) | Upgrade a project to the current schema | Yes |
| Maintenance | [`validate [path]`](#validate) | Check structure, frontmatter, and registries | No |
| | [`reindex [path]`](#reindex) | Rebuild registry tables from entity files | Yes |
| | [`wordcount [path]`](#wordcount) | Count chapter prose words | With `--write` |
| | [`links [path]`](#links) | Check cross-references and backlinks | No |
| Analysis | [`continuity [path]`](#continuity) | Check deaths, casts, promises, questions, clues, prop custody, clock and travel time, routes, and state | No |
| | [`knowledge <id>`](#knowledge) | List what a character knew at a chapter, marked reader-knowledge or character-knowledge | No |
| | [`context <id>`](#context) | Pack drafting context for a chapter or scene; unread flashback facts are marked do not reveal | No |
| | [`compare [path]`](#compare) | Compare chapters with an earlier draft | No |
| | [`similarity [path]`](#similarity) | Find passages that share a run of words with other text: earlier books, a draft, or a source | No |
| | [`progress [path]`](#progress) | Show words against targets and deadline | With `--log` |
| | [`timeline [path]`](#timeline) | Show scenes in story-time order, POV balance, presence | No |
| | [`prose [path\|-]`](#prose) | Lint chapter prose, or a passage piped to stdin | No |
| | [`series [path]`](#series) | Order linked books and check shared canon | No |
| | [`report [path]`](#report) | Summarise inventory, progress, and checks | No |
| | [`next [path]`](#next) | Recommend the next actions | No |
| | [`doctor [path]`](#doctor) | Show health checks and repair steps | No |
| Craft and revision | [`pacing [path]`](#pacing) | Show scenes, sequels, outcomes, hooks, and length per chapter | No |
| | [`clues [path]`](#clues) | Show the clue plant and reveal grid and flag fair-play problems | No |
| | [`voices [path\|-]`](#voices) | Fingerprint each character's tagged dialogue, in the chapters or a passage piped to stdin | No |
| | [`names <name...>`](#names) | Check candidate names for clashes and look-alikes | No |
| | [`diagram <kind>`](#diagram) | Print Mermaid source for relationships, locations, timeline, clues, or arcs | With `--out` |
| | [`passes [path]`](#passes) | Show and update the named revision passes in `story.md` | With `--init`, `--start`, or `--done` |
| Entities | [`add <kind> <name>`](#add) | Create an entity file and reindex | Yes |
| | [`rename <kind> <id> <name>`](#rename) | Rename an entity and update references | Yes |
| | [`move <kind> <id>`](#move) | Renumber a chapter or move a scene and update references | Yes |
| | [`remove <kind> <id>`](#remove) | Delete an entity and scrub references | Yes |
| Output | [`export [path]`](#export) | Write a combined manuscript markdown file | Yes |
| | [`build [path]`](#build) | Build markdown, EPUB, DOCX, Shunn, HTML, print, narration, metadata, Fountain, or Twine output in `dist/` | Yes |
| | [`synopsis [path]`](#synopsis) | Print or write a 1- or 3-page synopsis from arcs | With `--out` |

## How the CLI behaves

### Help and version

`story --help`, `story -h`, `story help`, and `story` with no command all print the usage summary, with every command and option, to stdout and exit 0. `story help <command>` and `story <command> --help` print that command's usage line, summary, and only the options it reads, plus `--path` (for commands that take a project), `-h`, and `-v`:

```shell
story help validate
```

```text
Usage: story validate [path] [options]

Check project structure, frontmatter, and registries

Options:
  --path <path>             Project root for every command except init and
                            import
  -h, --help                Show this help
  -v, --version             Show the story CLI version
```

`story help` with a name that is not a command fails like an unknown command (below): `story help frob` prints `Unknown command: frob` and exits 2.

`story --version` (or `-v`) prints the version and exits 0. It wins over every other command and option on the line, including `--help`, but not over a malformed command line: `story validate --bogus -v` still fails with `Unknown option --bogus`, and `story export --out -v` with `Missing value for --out`.

```shell
story --version
```

```text
0.19.0
```

An unknown command prints `Unknown command: <name>`, with a suggestion when the name is close to a real command, and a pointer to the help, to stderr, and exits 2:

```text
$ story valdate
Unknown command: valdate; did you mean validate?
Run story --help to list commands.
```

The help text is generated from the command and option registries in [`src/commands.js`](../src/commands.js) and [`src/options.js`](../src/options.js), so it always matches what the CLI accepts. The version comes from [`src/version.js`](../src/version.js).

### Project paths

Every command except `init` and `import` works on one story project: a directory with a `story.md` at its root. How you point a command at that directory depends on the command.

| Commands | How to give the project | Default |
|---|---|---|
| `validate`, `reindex`, `wordcount`, `links`, `continuity`, `compare`, `similarity`, `progress`, `timeline`, `prose`, `pacing`, `clues`, `voices`, `series`, `passes`, `report`, `next`, `doctor`, `migrate`, `export`, `build`, `synopsis` | A positional `[path]` **or** `--path <path>` | Current directory |
| `knowledge`, `context`, `names`, `diagram`, `add`, `rename`, `move`, `remove` | `--path <path>` only, because their positionals are ids, names, or a diagram kind | Current directory |
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

`prose -` and `voices -` read a passage from stdin instead of the chapters. The `-` takes the place of the positional path, so give the project with `--path` or run from its directory (see [Reading from stdin](#reading-from-stdin)).

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

Every command, including `validate`, `next`, and `doctor`, reports that same line. Once `story.md` is in place, `validate` lists every other missing required file, which makes it useful for diagnosing a half-built project.


### Reading from stdin

`-` in place of a file or project path reads standard input, so an agent can check a passage before writing it to a chapter file, or import a draft it has in hand.

| Command | What `-` reads | Project |
|---|---|---|
| `story prose -` | A passage to lint | `--path`, else the current directory if it holds `story.md`, else none: the default rules without a style sheet |
| `story voices -` | A passage whose dialogue to fingerprint | `--path`, else the current directory; required, since speakers are the project's characters |
| `story import -` | The manuscript to split into chapters | None; `--dir` chooses where the new project goes, as usual |

```shell
story prose - --path ~/stories/the-last-ember < draft-scene.md
printf '%s\n' "$PASSAGE" | story voices - --path ~/stories/the-last-ember
pandoc draft.docx -t markdown | story import - --title "The Lost Coast"
```

- The input must be UTF-8 text of at most 5 MB. A leading byte-order mark is dropped, and a zip, a binary, or text in another encoding is refused as `import` refuses a file: `Cannot read stdin: it is not valid UTF-8 text. Pipe UTF-8 plain text or markdown instead`.
- Empty input is an error (`story prose - read nothing from stdin: ...`), and so is a terminal, so the command never sits waiting for typing: `story prose - reads from stdin, but stdin is a terminal: pipe the text in, such as story prose - < draft.md`. A stdin error (empty, a terminal, binary, a zip archive, or not UTF-8) is a usage error and exits `2`.
- A file literally named `-` is reached as `./-`.
### Option syntax

- Options can appear anywhere after the command: `story build --format epub .` and `story build . --format epub` are the same.
- Value options take the next argument (`--out book.md`) or an inline value (`--out=book.md`). Use the inline form when the value itself starts with `--` or is `-h` or `-v`, which would otherwise be read as an option.
- Positional arguments may start with a single dash, so `story add term "-ism"` works. A lone `--` ends the options: everything after it is positional, so `story init -- --Untitled` creates a story titled `--Untitled`. Put any options before the `--`.
- Boolean flags (`--force`, `--write`, `--log`, `--shunn`, `--init`, `--actionable`, `--json`, `--sequel`, `--significance-delayed`, `--red-herring`, `--heading`) are true when present. They also accept an explicit value, inline or as the next argument: `true`, `false`, `yes`, `no`, `on`, `off`, `1`, or `0`. So `--write false` turns writing off, while `--write=maybe` is an error.
- Repeatable options collect every value, and list options also split on commas, so `--character ilse-marrow --character tobin-reyes` and `--characters ilse-marrow,tobin-reyes` produce the same list. `--source`, `--follows`, and `--precedes` keep each value whole.
- A singular flag and its plural alias combine, so `add chapter --character ivo-pell --characters mara-quill` lists both; `add` also drops repeated values from a list. `add character --arc` is single-valued and has no plural alias.
- For options that are not repeatable, the last value wins: `--out a.md --out b.md` writes `b.md`.
- Unknown options, missing values, extra positional arguments, and options the command does not read are errors. Each command accepts only its own options plus `--path`:

An unknown option close to one the command accepts gets the same kind of suggestion, naming every equally close option (up to three). A single-dash word such as `-x` is a positional argument, so on a command that takes a `[path]` it is read as the project path; when no such project exists, the error says it is not an option.

```text
$ story validate --verbose
Unknown option --verbose

$ story build --formt epub
Unknown option --formt; did you mean --format?

$ story validate -x
~/stories/the-salt-road/-x is not a story project: missing story.md; -x is not an option (run story help)

$ story export --out
Missing value for --out: expected a value

$ story validate . extra
Unexpected argument for story validate [path]: extra

$ story timeline --trim 6x9
--trim does not apply to story timeline
```

### Defaults and severity from story.md

A project can set default flags per command and change how warnings are reported, in the optional `cli-defaults` and `severity` fields of `story.md`:

```yaml
cli-defaults:
  - command: build
    format: html
  - command: prose
    max-adverbs: 10
severity:
  - warning: todo-markers
    level: error
```

With these, `story build` builds the HTML review copy, `story prose` warns above 10 adverbs per 1,000 narration words, and `story validate` fails on a leftover `[TODO` marker:

```text
$ story validate
Project validation failed: 1 errors, 0 warnings, 0 dismissed
error: chapters/chapter-03.md has 1 [TODO marker in its prose, which every build prints: resolve it or move it into an HTML comment [todo-markers]
```

Defaults apply with `--json` too, and to `prose -` and `voices -` inside a project; `--json` itself cannot be a default. With `--json`, a promoted warning is a diagnostic with `severity` `"error"` and makes `ok` false, and an `off` warning is a `dismissed` diagnostic. `story prose --json` reports the limits it used in `data.thresholds`. A flag on the command line always wins over a default: `story build --format epub` still builds an EPUB, and it also drops any default `--trim`, `--stamp`, `--note-url`, or `--shunn`, which belong with a particular format. Likewise `--ref` or `--against` on `compare` drops a default for the other. `level: off` reports a warning as `dismissed:` instead. A `severity` entry names any warning by the code its line ends with (see [Finding codes](#finding-codes)), and applies wherever that warning is reported: in the check that raises it, in the checks `report`, `next`, and `doctor` summarise, and in the warnings `build`, `export`, `context`, `add`, `rename`, `move`, and `remove` print after their output, which then exit 1 when a promoted warning is among them. Errors cannot be demoted or turned off, so an entry naming an error code is rejected. `story validate` rejects unknown commands, flags, codes, and levels; while either field is invalid, other commands refuse to run until it is fixed and exit 3. The [Project format reference](project-format.md#cli-defaults-and-severity) lists every rule.

### Output streams and exit codes

The CLI prints results to stdout and diagnostics to stderr.

- `validate`, `links`, and `continuity` write everything to **stderr**: a summary line, then one line per `error:`, `warning:`, and `dismissed:` finding. Nothing goes to stdout. A `warning:` line ends with the warning's [code](#finding-codes) in brackets, as does an `error:` line for a warning `severity` promoted.
- `compare`, `similarity`, `progress`, `timeline`, `prose`, `pacing`, `clues`, `voices`, `names`, and `series` write their report to stdout, then the same summary and finding lines to stderr.
- `diagram` writes the Mermaid source (or, with `--out`, a confirmation) to stdout. If the project has a file that fails to parse, it writes the summary and error lines to stderr instead.
- All other commands write a short confirmation or report to stdout.
- Errors that stop a command (a bad option, a missing project, an unknown id) print one line to stderr.
- With `--json`, the command prints one JSON object to stdout and nothing to stderr. See [JSON output](#json-output).

The examples on this page show stdout and stderr together, as a terminal does.

| Exit code | Meaning |
|---|---|
| `0` | The command succeeded. For checks, there were no errors. Warnings and dismissed findings do not change the exit code, unless `severity` in `story.md` promotes a warning to an error. |
| `1` | Findings: a check reported at least one `error:` line. |
| `2` | Usage error: an unknown command or option, a missing or invalid option value, an unexpected argument or option, a missing required argument (such as `knowledge` without `--at`), an id that does not exist, or an `import` source that is missing or cannot be read. |
| `3` | Not a usable story project: no `story.md`, invalid `cli-defaults` or `severity` in `story.md` (for commands other than `validate`, `report`, `next`, and `doctor`), a file the command needs cannot be read or parsed or is a symlink, a newer schema than this CLI knows, or nothing to build from. |
| `4` | Refused or failed write: the target already exists, is project source or outside the project, is a symlink, is locked by another story command, changed on disk meanwhile, or the file system refused it. |

Findings keep `1`, so `story validate || exit 1` fails on errors as it always has. Before these codes were split, every failure exited `1`; a script that tested for `1` to catch a usage error, a missing project, or a refused write should test for `2`, `3`, or `4` instead, or for any non-zero code. The codes are exported as `EXIT_CODES` from `src/exit-codes.js`.

`report`, `next`, and `doctor` summarise check results but always exit 0 on a readable project. `prose`, `pacing`, `clues`, and `voices` report every craft finding as a warning, so they exit 1 only when a file fails to parse or a [`severity`](#defaults-and-severity-from-storymd) entry in `story.md` promotes one of their warnings to an error. `passes` exits 0 unless it refuses a change: `2` for a bad pass name, `3` for a `story.md` it cannot safely rewrite, `4` when the write fails. `names` exits 1 when a candidate clashes with an existing name. Use `validate`, `links`, and `continuity` when you need a failing exit code, for example in CI (see [Automation and CI](automation.md)).

### JSON output

`--json` prints one JSON object on stdout instead of the text report, for scripts and agents. It works on the check and analysis commands: `validate`, `links`, `continuity`, `series`, `report`, `next`, `doctor`, `knowledge`, `context`, `progress`, `timeline`, `prose`, `pacing`, `clues`, `voices`, and `similarity`. Other commands refuse it (`--json does not apply to story wordcount`). Nothing is written to stderr, and the exit code is the same as without `--json`: `1` for findings, `2` for a usage error, `3` for a folder that is not a usable story project, and `4` for a refused write (see [Output streams and exit codes](#output-streams-and-exit-codes)). `ok` is `true` exactly when the exit code is `0`.

Every result has the same envelope:

| Field | Meaning |
|---|---|
| `apiVersion` | `"story/v2"`. Fields may be added within a version; renaming, removing, or retyping one changes it. `story/v1`, in 0.16.0, put the check name in `code`; `story/v2` puts the rule code there and the check name in `check`. |
| `command` | The command that ran, such as `"continuity"`. |
| `ok` | `true` exactly when the command exits `0`. |
| `data` | The command's result: counts for `validate`, `links`, and `continuity`; the report, grid, or profile for the others. `null` when the command stopped before producing one. Fields a project does not set are `null`, not missing. |
| `diagnostics` | One entry per finding, in the order the text output prints them: `severity` (`error`, `warning`, or `dismissed`), `file` (the project file the finding is about, `stdin` for a finding about a passage piped to `prose -` or `voices -`, or `null` when it is about no one file), `message` (the line the text output prints after `error:` or `warning:`, without the trailing `[code]`), `code` (the finding's rule, from [Finding codes](#finding-codes)), and `check` (the check that raised it: `validate`, `links`, `continuity`, or the command's own name). A dismissed finding also has `exemption`, the reason from `continuity/exemptions.md`, or `severity <code> is off in story.md`, and `exemptionIndex`, the position of the matching entry in the `exemptions` list (`0` for the first), or `null` for a `severity` entry. Every diagnostic has `chapter`, the chapter id for the `continuity` findings that [carry one](continuity.md#exemptions), else `null`. |
| `writes` | Absolute paths of the files the command wrote. Only `progress --log` writes. |

`report`, `next`, and `doctor` put a `checks` summary in `data` (`ok` and error, warning, and dismissed counts for `validate`, `links`, and `continuity`) and list each check's findings in `diagnostics`. They still exit `0`, so their `ok` is `true` even when a check fails: read `data.checks` to gate on them. `report --json` always includes `actions`.

A command that cannot run (an unknown option, a missing argument, a missing project, an unknown id) also prints an envelope when `--json` is on, with `ok: false`, `data: null`, and the error as its one diagnostic, coded `usage-error`, `unusable-project`, `write-refused`, or `command-failed` to match the exit code. `prose - --json` and `voices - --json` report a piped passage as one chapter with `file` `stdin`, and a stdin error, such as empty input, is the error envelope. `--json false` and `--json=off` keep the text output. `--help` and `--version` print their usual text even with `--json`.

```shell
story continuity examples/the-unraveled-thread --json
```

```text
{
  "apiVersion": "story/v2",
  "command": "continuity",
  "ok": false,
  "data": {
    "errors": 4,
    "warnings": 3,
    "dismissed": 0
  },
  "diagnostics": [
    {
      "severity": "error",
      "file": "chapters/chapter-04.md",
      "chapter": "chapter-04",
      "message": "chapters/chapter-04.md lists edran-vale, who died in chapter-02; move posthumous appearances to mentions",
      "code": "posthumous-appearance",
      "check": "continuity"
    },
    ...
  ],
  "writes": []
}
```

[`schemas/result.schema.json`](../schemas/result.schema.json) describes the envelope and the `data` of each command.

### Where commands write

Commands that write files keep them inside the project root. A relative `--out` path resolves against the **project root**, not the current directory, and must stay inside it:

```shell
story export --out ../outside.md
```

```text
Refusing to access path outside project root: ~/stories/outside.md
```

An absolute `--out` path is written where you say. Generated and rewritten files are written whole or not at all: the new contents go to a hidden temporary file beside the target (`.chapter-01.md.story-<pid>.tmp`), which is flushed to disk and then renamed over it. A full disk, a failed write, or a killed process leaves the old file intact rather than truncated, and the error names the target, not the temporary file (`Cannot write to chapters/chapter-01.md: no space left on the device`). An existing file keeps its permissions and a read-only one is refused (`Cannot write to dist/manuscript.md: permission denied`), and the folder must be writable too. A target that is a hard link, such as an `--out` path linked to a chapter, is replaced rather than written through, so the linked file is left unchanged. If a process is killed before the rename, `story validate` warns about the leftover temporary file (`<path> was left by an interrupted write to <target>; delete it once the files beside it look right`). The CLI also refuses to write through symlinks or into symlinked project directories, and it never reads a project text file that is a symlink, a device or FIFO, or larger than 5 MiB (see [Scanning limits and safety](project-format.md#scanning-limits-and-safety)). Scans skip `dist/`, `node_modules/`, and dot-directories, so build output never feeds back into checks.

Commands that change project files (`add`, `rename`, `remove`, `move`, `reindex`, `migrate`, and `wordcount --write`) hold a lock file, `.story.lock` in the project root, while they run. Each plans its rewrites from what it read, so two at once, such as two agent sessions or an editor hook running `reindex` while you run `rename`, could lose each other's reference updates or bring back a deleted file in ways `story reindex` cannot repair. A second command waits up to 10 seconds for the first to finish (set `STORY_LOCK_WAIT_MS` to change that; `0` refuses at once), then refuses with the project unchanged: `another story command (process 4242) is modifying this project; nothing was changed. Run write commands one at a time. If no story command is running, delete .story.lock in the project folder and try again`. A lock left by a command that was killed is taken over, since its process is gone. A lock from another machine, such as a container, a cloud agent, or a shared folder, cannot be checked that way: one older than 10 minutes, by both the time written in it and the file's modification time, is taken over, and a newer one is left in place with the same message, which tells you to delete `.story.lock`. A project folder the user cannot write to is not locked; the command then fails only if it needs to write. Rewrites also check that each file still holds what the command read, so a chapter an editor saves meanwhile is left as saved (`chapters/chapter-01.md changed on disk while story was updating it, so it was left as it is. Run the command again`).

A file-system failure reads `Cannot <action> <path>: <reason>`, with the path relative to the current directory when it is inside it. The action is `open`, `list`, `check`, `replace`, `create the folder`, `delete`, `copy`, or `write to`, and the reason is `permission denied`, `no such file or folder`, `it is a folder, not a file`, `a part of the path is not a folder`, `the file system is read-only`, `no space left on the device`, `the disk quota is exceeded`, `the file is too large`, `an input/output error`, `the file is in use`, or `the name is too long`.

`--out` on `export`, `build`, `synopsis`, and `diagram` never overwrites project source: `story.md`, `style-sheet.md`, `progress.md`, or anything under `characters/`, `chapters/`, `scenes/`, `worldbuilding/`, `plot/`, `continuity/`, `glossary/`, `matter/`, or `research/`. It may add a new file under the skill-owned folders `feedback/`, `submission/`, `publishing/`, and `adaptations/`, such as a first synopsis draft, but never replaces one there, because those files are edited by hand and reader notes exist nowhere else; delete the old file first to regenerate it. Folder names match in any letter case (`Chapters/x.md` is refused), and a path through a symlink is checked against the real folder it points to, so `lnk/x.md` is refused when `lnk` links to `chapters`. The real path is compared in any letter case as well, so an absolute path typed in another case on a case-insensitive disk (the macOS default) is caught. It must also name a file, not a directory; `--out dist` is refused even before `dist/` exists:

```text
$ story export --out chapters/chapter-01.md
Refusing to write generated output to chapters/chapter-01.md: it is project source. Use a path such as dist/ instead

$ story export --out feedback/round-1/ann.md
Refusing to overwrite feedback/round-1/ann.md: files in feedback/, submission/, publishing/, adaptations/ may hold hand-written work. Delete it first to regenerate it, or use a path such as dist/ instead

$ story build --out dist
--out dist is a directory: give a file path
```

### Files that fail to parse

Commands that rewrite registries or assemble chapters stop when an entity file, a registry, or `story.md` fails to parse, because carrying on would silently drop that file. `reindex`, `wordcount`, `export`, `build`, `synopsis`, `add`, `migrate`, `rename`, `move`, `remove`, and `progress --log` name the files and change nothing:

```text
$ story reindex
Cannot reindex: fix this file first (story validate reports it):
- characters/old-bram.md: Duplicate frontmatter key: name
```

The other commands name themselves: `Cannot count words`, `Cannot export`, `Cannot build`, `Cannot build a synopsis`, `Cannot add`, `Cannot migrate`, `Cannot rename`, `Cannot move`, `Cannot remove`, and `Cannot log progress`. With several files the line reads `fix these files first (story validate reports them)`. `rename`, `move`, and `remove` also read every other markdown file before writing, and stop with `<file>: <error>; nothing was changed` when one of those fails to parse. A `style-sheet.md` or `progress.md` that fails to parse does not block them; `story validate` reports it.

A parse error names the file by its path inside the project, never an absolute path, for every file including `story.md`, the registries, `progress.md`, and `style-sheet.md`: `story.md: is missing YAML frontmatter`. When `story.md` cannot be read, `validate` reports that once rather than also listing each required field as missing.

## Setup commands

### init

```text
story init <title> [options]
```

Scaffolds a new story project: `story.md`, `style-sheet.md`, `plot/timeline.md`, `continuity/state.md`, every entity folder, empty registries, and a `.gitignore`. The story id is the kebab-case form of the title (`The Salt Road` becomes `the-salt-road`), and the project goes in a directory of that name unless you pass `--dir`. A title with no ASCII letters or digits takes its story id from the folder name instead. A Cyrillic or Greek title is transliterated for the default folder (`story init "Война и мир"` creates `voyna-i-mir/`, so the id is `voyna-i-mir`), and `--dir` picks another (`story init "Война и мир" --dir voina` gives the id `voina`). A title in a script with no transliteration table, such as `红楼梦`, has no kebab-case form, so it needs `--dir` with an ASCII folder name. The id follows the `story.md` title on every run, so after changing the title run `story reindex` to rewrite it in the registries, `plot/timeline.md`, and `continuity/state.md`; until then `story validate` fails with `story must be <new-id>`.

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
| `--form <form>` | `form`, and a starting `target-words` for that form (see below) | Unset |
| `--synopsis <text>` | Text of the `## Synopsis` section | `Add a 2-3 sentence synopsis here.` |
| `--series <id>` | Kebab-case series id | Inherited from a linked book |
| `--book-number <n>` | Publication order: `0` or a positive number, such as `2`, `0` for a prequel, or `1.5` for a novella | With `--follows` or `--precedes`, one more than the highest number in the linked series; otherwise unset |
| `--follows <path>` | This book is set after the story at `<path>`; repeatable | |
| `--precedes <path>` | This book is set before the story at `<path>`; repeatable | |
| `--force` | Use an existing directory: add missing starter files, never overwrite existing ones | Off |

An empty `--genre`, `--pov`, or `--tense` (such as `--tense=` from an unset shell variable) is refused with `--tense cannot be empty: leave it out to use the default`; `import` does the same.

Without `--force`, `init` refuses an existing directory:

```shell
story init "The Salt Road"
```

```text
~/stories/the-salt-road already exists. Use --force to add missing starter files; existing files are never overwritten.
```

With `--force` on a directory that already has a `story.md`, `init` keeps that `story.md`, prints `Updated story project: <dir>` instead of `Created`, and takes the story id for any new registry from the kept title. A title that differs from the kept one, and any `story.md` option you passed (`--genre`, `--form`, `--synopsis`, and so on), is named in a warning, since it was not applied: `warning: story.md already exists and was kept, so the title and --genre were not applied. Edit story.md to change them.`

The `.gitignore` lists `dist/`, so builds stay out of commits, plus `.story.lock` and the `.*.story-*.tmp` and `.story-*.tmp` files an interrupted command can leave behind, and common OS and editor files (`.DS_Store`, `Thumbs.db`, `*.swp`, `*.swo`, `*~`). `init` writes it only when the project has none, `--force` included, and never edits an existing one; a symlinked `.gitignore` is left alone and not read, and one that is not UTF-8 text is kept without a check. When a kept `.gitignore` has no `dist/` rule (`dist`, `dist/`, `/dist/`, `dist/*`, `dist/**`, or `**/dist/`), or a later negation such as `!dist/book.epub` re-includes part of it, `init` still succeeds and prints a note on stderr:

```text
note: .gitignore was kept and does not ignore dist/, so builds would be committed. Add a dist/ line to keep them out.
```

A `.gitignore` in an enclosing repository is not checked, so a book inside a larger repository gets its own `.gitignore` too; the two do not conflict.

It also refuses a story id or target folder name that Windows reserves (`con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9`, also with an extension such as `con.txt`), a folder name ending in a dot or space, and a folder name containing `< > : " | ? *`, because the project could not be checked out there:

```shell
story init con
```

```text
Cannot use story id con: Windows reserves the file name con. Choose a longer name, such as "con story"
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
Updated series links in ~/stories/the-last-ember/story.md
```

`--form` records the kind of book and sets `target-words` to a typical length for it. `story validate` warns when `target-words`, or the manuscript of a book with `status: complete`, falls outside the form's usual range. The form is not inherited from a linked book.

| Form | Target set by `init` | Range `validate` checks |
|---|---|---|
| `flash` | 1,000 | 1-1,500 |
| `short-story` | 5,000 | 1,000-7,500 |
| `novelette` | 12,000 | 7,500-17,500 |
| `novella` | 30,000 | 17,500-40,000 |
| `novel` | 80,000 | 40,000-200,000 |
| `serial` | None | None |
| `picture-book` | 500 | 1-1,000 |
| `chapter-book` | 10,000 | 4,000-15,000 |

```shell
story init "The Salt Road" --form novella
```

writes these lines into `story.md`:

```yaml
form: novella
target-words: 30000
```

An unknown form stops before anything is written:

```text
$ story init "Bad Form" --form epic
Unsupported form "epic": expected one of flash, short-story, novelette, novella, novel, serial, picture-book, chapter-book
```

See [Series](series.md) for how linked books are ordered and checked, and [Getting started](getting-started.md) for what to do after `init`.

### import

```text
story import <source|-> --title <name> [options]
```

Creates a new project from an existing manuscript. `<source>` is a single `.md`, `.markdown`, or `.txt` file, or a directory of them, or `-` to read the manuscript from stdin. Piped text is read as markdown (as a `.md` file would be), a piped document with no chapter headings becomes `Chapter 1`, and the synopsis placeholder says `Imported from stdin`. `--title` is required. A directory that already has a `story.md` is refused, since it is a story project rather than a draft: `drafts/salt-road is already a story project (it has story.md); import reads manuscript files, so point it at the draft instead`.

- A source file must be UTF-8 text; a leading byte-order mark is dropped, and a zip file (such as a `.docx`), a binary file, or text in another encoding is refused (`it is not valid UTF-8 text. Save it as UTF-8 plain text or markdown first`). CRLF and bare CR line endings are read as line breaks.
- A file with `Chapter` headings (ATX `#` headings of any level, or setext headings underlined with `===` or `---`, with arabic numbers including decimals such as `12.5`, roman numerals, spelled-out numbers up to nine hundred and ninety-nine, or none) is split at each heading, and `Prologue`, `Epilogue`, `Interlude`, and `Afterword` headings become chapters of their own. Text before the first chapter heading becomes a chapter titled `Opening`, unless it is only HTML comments, which move to the top of the first chapter (the `<!-- Generated by story export. -->` marker is dropped). Headings inside code fences and HTML comments never split, and a `# Part ...` heading just before a chapter heading opens that chapter.
- A chapter file in Story Skills' own layout (frontmatter and a `## Chapter Text` section) imports as one chapter with its `title`, any `numbered: false`, and the prose under `## Chapter Text`.
- A file without markdown chapter headings is split on plain-text chapter lines standing alone between blank lines, such as `Chapter 3`, `CHAPTER ONE: Arrival`, `Prologue`, or `Epilogue: After`. The number or word must stand alone or be followed by a separator (`:`, `.`, `-`, `–`, `—`), with or without a title (a bare `Prologue:` splits, and `Chapter 3:` is titled `Chapter N` with its new number and a plain `# Chapter N` heading), so `Chapter 12 was the worst.` and `Chapter Nine Lives of a Cat` do not split. A single short line before the first one is treated as the book title.
- A file with neither becomes one chapter, titled by its first `#` heading or by its file name.
- When numbered plain `Chapter N` lines did not split a file, because it also has markdown chapter headings or because a line is not between blank lines, `import` warns with the count and the first one: `warning: t.txt: 2 plain-text chapter lines were not used to split chapters (first "Chapter 1" at line 1): ...`.
- A directory is imported in natural file-name order (`chapter-2` before `chapter-10`). Files with no number in their name come after the numbered ones, except prologue, preface, foreword, introduction, and prelude files, which come first. Hidden files (`.name`), macOS AppleDouble files (`._name`), and Word lock files (`~$name`) are skipped. Symlinks are never followed; a symlink to a document is refused.
- Leading YAML frontmatter in source files is dropped. A leading `---` block that starts with a blank line, or holds a line that is not YAML (such as `She said: go now.`), is a scene break and is kept. A trailing Pandoc attribute block on a heading (`# Chapter 1: Arrival {#arrival .unnumbered}`) and closing hashes (`## Title ##`) are dropped from the title. `Prologue`, `Epilogue`, `Interlude`, and `Afterword` chapters, and chapter headings marked `{.unnumbered}` or `{-}`, are written with `numbered: false`, so builds head them with their title alone and number the other chapters from 1.
- In `.md` and `.markdown` sources, Pandoc's `---` becomes an em dash and `--` an en dash, except inside inline code, closed `` ``` `` code fences, HTML comments (everything after a `<!--` that never closes), link targets (`](...)`), autolinks (`<https://...>`), bare URLs, `www.` addresses, email and `mailto:` addresses, and HTML tags, and on lines made only of dashes (scene breaks), table separator rows (`|---|---|`), and indented code lines (four spaces or a tab). An indented line that continues a list item is prose and is converted. In `.txt` sources, leading tabs and spaces are removed from every line, so indented paragraphs do not become code blocks.

Each chapter is written to `chapters/chapter-NN.md` with `status: draft` and its word count, and the registries are rebuilt. `import` then prints up to 25 capitalised names that appear three or more times, as candidates for `story add character` or `story add location`.

`import` accepts `--dir`, `--genre`, `--sub-genre`, `--setting-era`, `--theme`, `--themes`, `--pov`, `--tense`, `--synopsis`, and `--force`, with the same meaning as for `init`, and writes the same `.gitignore` (or prints the same note about a kept one). The series options (`--series`, `--book-number`, `--follows`, `--precedes`) and `--form` are errors (`--form does not apply to story import`); add `form` to `story.md` by hand after importing. Without `--synopsis`, the synopsis placeholder names the source file.

`--language <tag>` names the manuscript's language, a BCP 47 tag such as `fr` or `pt-BR`; a value that is not one is a usage error. It picks the language pack whose heading words (`Chapter`, `Prologue`, `Part`, spelled-out numbers) split the chapters and whose stopwords filter the entity candidates: English, Spanish (`Capítulo veintiuno`, `Prólogo`), French (`Chapitre vingt et un`, `Prologue`), and German (`Kapitel Einundzwanzig`, `Erstes Kapitel`, `1. Kapitel`, `Prolog`) have them, with ordinal-first part headings (`Primera parte`, `Première partie`, `Erster Teil`), and German leaves out capitalised common nouns (`die Tür`) from the candidates. In another language only the markdown or text structure is used, never English headings, unless the project's `style-sheet.md` supplies the words (see [Word lists](project-format.md#word-lists)); `import --force` into an existing project reads its style sheet. A new project records the tag as `language` in its `story.md`. Without `--language`, `import --force` into an existing project uses that project's `story.md` `language`, and a new project uses English and writes no `language`. A `--language` that differs from a kept `story.md` is named in the `kept-story-options` warning, since `story.md` is not changed.

> [!WARNING]
> With `--force` on an existing directory, `import` deletes every `chapter-NN.md` in `chapters/` before writing the imported chapters, and the frontmatter you filled in on those chapters is lost. Commit or back up the project first. It first checks that every other project file parses, and changes nothing if one does not. It keeps the existing `story.md` (warning about a `--title` or other `story.md` option it did not apply) and prints a note to run `story links`, since scenes and bible entries may point at chapters that are gone or changed.

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

Upgrades a project to the current schema (version 2). It creates every folder `story init` creates when it is missing, and any missing v2 starter files (`plot/timeline.md`, `scenes/_index.md`, `continuity/state.md` and the question, promise, and clue ledgers, and `glossary/_index.md`), sets `schema-version: 2` in `story.md`, and runs `reindex`. Existing files are never overwritten. On a project that is already current it still runs `reindex`, so a stale registry is rebuilt and counted as a change. A `story.md` that fails to parse stops it with `Cannot migrate: fix this file first`, and a `schema-version` newer than 2 is refused rather than downgraded: `story.md uses schema-version 3, newer than this CLI (2); upgrade story-skills`.

On a copy of a project with `schema-version: 1` and no clue ledger or glossary:

```text
$ story validate
Project validation failed: 3 errors, 0 warnings, 0 dismissed
error: Missing required path: continuity/clues/_index.md (story migrate adds missing registries)
error: Missing required path: glossary/_index.md (story migrate adds missing registries)
error: story.md schema-version must be 2

$ story migrate
Migrated project to current schema: 5 changes

$ story validate
Project is valid: 0 errors, 0 warnings, 0 dismissed
```

When nothing needed changing, including the registries:

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

- every required file exists (entity folders are optional)
- every markdown file's YAML frontmatter parses, and required fields are present with valid values and types
- entity ids are kebab-case and enum fields (roles, statuses, types) use allowed values
- no entity file uses a name Windows reserves, such as `characters/nul.md` (warning: `characters/nul.md uses a file name Windows reserves, so the project cannot be checked out on Windows; rename the entity`)
- each registry `_index.md` links every entity file (warning)
- declared chapter `word-count` values match the prose (warning)
- no chapter opens an HTML comment (`<!--`) without closing it, which would leave the text after it in builds and word counts; a `<!--` inside a closed `` ``` `` code fence or an inline code span does not count (warning)
- no chapter's prose holds a `[TODO` marker (`[TODO: check bible]`), which every build would print; a marker inside an HTML comment does not count (warning: `chapters/chapter-01.md has 1 [TODO marker in its prose, which every build prints: resolve it or move it into an HTML comment`)
- each chapter has at least one scene record (warning)
- chapter `hook` and `choices` (each a `text` with no Twine link syntax and a kebab-case `to`), the `story.md` `ifid` (a version 4 UUID), scene `outcome`, clue `red-herring`, location `routes`, character `voice-words` and `voice-avoid`, `pronunciation` fields, and research `accuracy`, `confidence`, `method`, and `risk` use allowed values and types
- matter pages have text; research marked `verified` lists sources; research that is still `open` or `disputed` is not relied on by a `final` or `complete` chapter; research with a `risk` and no `reviewed-by` is not relied on by a `final` or `complete` chapter; research with `accuracy: invented` is exempt from the source checks; no stray `.md` files sit at the project root or nested inside entity directories (warnings)
- matter `permission` is `not-needed`, `pending`, `granted`, or `public-domain`; a `pending` permission on a complete story, or a `granted` one with no `rights-holder`, is a warning
- `target-words`, and the manuscript length of a complete story, fall inside the usual range for the `form` in `story.md` (warning)
- publishing fields in `story.md` are well formed: `language` is a BCP 47 tag, `isbn` a valid ISBN-10 or ISBN-13, `publication-date` a real date, `subjects` BISAC codes; more than seven `keywords` is a warning
- `revision-passes` in `story.md` is a list of kebab-case passes with a `pending`, `in-progress`, or `done` status
- `progressions` on characters, locations, and factions are well formed and in story order: each entry has a `from` chapter, a kebab-case `field` that is not a list field, and a single `value` allowed for that field, and no two entries change the same field from the same chapter; a character progression to `status: deceased` without a matching `died-in` is a warning (see [Progressions](project-format.md#progressions))
- `style-sheet.md`, `progress.md`, `continuity/exemptions.md`, and the `story.md` `cover` image are well formed, when present
- `follows`, `precedes`, and `cover` in `story.md` use `/`, not a Windows `\`, which resolves on Windows but not on Linux or macOS CI (warning: `story.md follows ..\ser1 uses a backslash; write ../ser1 so the path works on every system`); `story links` reports the same in series links, and in markdown links in `plot/timeline.md` and arc bodies, as errors

Errors exit 1; warnings alone exit 0.

After hand-writing `characters/old-bram.md` with `locations: dock-nine` (a string, not a list) in a project with an empty acknowledgments page:

```shell
story validate
```

```text
Project validation failed: 1 errors, 2 warnings, 0 dismissed
error: characters/old-bram.md frontmatter field locations must be a list
warning: matter/acknowledgments.md has no text and is left out of export and build [empty-matter]
warning: characters/_index.md does not list characters/old-bram.md; run story reindex [stale-registry]
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

Hand-written sections of the registries survive a reindex: `## Relationship Map` and `## Family Trees` in the character registry, `## World Overview` in the world registry, and `## Story Structure`, `## Theme Tracking`, and the `structure` field in the plot registry. Any other `## ` section that reindex does not generate is kept too, after the generated sections, including one written above the `# ` title. Only a heading that reindex writes with a value, `## Total Word Count: N`, matches without its trailing `: <number>`, so every copy of it is the generated total and extra copies are dropped. Every other heading must match exactly: a hand-written `## Registry: 2` is kept, and so is a second section with the same heading as a generated one, such as a second `## Registry`. Headings inside a closed `` ``` `` code fence neither start nor end a section. Files whose content would not change are not rewritten, and a registry with CRLF line endings keeps them.

`reindex` refuses to run while an entity file, registry, or `story.md` fails to parse, because the rebuilt registry would drop that file; see [Files that fail to parse](#files-that-fail-to-parse).

Run it after you create, rename, or delete an entity file by hand. `add`, `rename`, `move`, `remove`, `migrate`, and `wordcount --write` reindex for you.

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

Counts the prose words in each chapter and prints a total. Only the chapter's prose counts: the text after `## Chapter Text`; failing that, the text after the first `---` divider below `## Outline` (or everything after `## Outline` if there is no divider); failing that, the body without its leading `#` heading. HTML comments, inline code, code between `` ``` `` fences, images, link targets, and markdown symbols are ignored (a `<!--` written inside a code block or an inline code span is code, not a comment). Only a `` ``` `` fence that closes hides its contents; a `~~~` line is a scene break, not a fence. A backslash escape counts as the character it escapes, and hyphenated words and contractions count once, so `didn\'t` is one word.

| Option | Effect |
|---|---|
| `--write` | Write each changed count into the chapter's `word-count` frontmatter, then reindex so `chapters/_index.md` shows the new totals |

On a copy of [`examples/the-unraveled-thread`](../examples/the-unraveled-thread/) after adding a 20-word paragraph to chapter 3:

```text
$ story validate
Project is valid: 0 errors, 1 warnings, 0 dismissed
warning: chapters/chapter-03.md declares 24 words but contains 44 [stale-word-count]

$ story wordcount --write
chapters/chapter-01.md: 34
chapters/chapter-02.md: 31
chapters/chapter-03.md: 44
chapters/chapter-04.md: 22
Total: 131
```

Without `--write`, the same counts are printed and nothing changes.

A Chinese or Japanese book, or one with `count-unit: characters`, is [counted in characters](project-format.md#counting-in-characters): each chapter's line gives its characters, the total says `Total: N characters`, and `--write` records `character-count` beside `word-count`:

```text
$ story wordcount --write
chapters/chapter-01.md: 3120
chapters/chapter-02.md: 2875
Total: 5995 characters
```

### links

```text
story links [path]
```

Checks that references between entities point at entities that exist and that two-way links are mirrored. It covers:

- character relationships, which need a backlink of the matching inverse type (`mentor` and `student`, `sibling` and `sibling`). The pairings allowed before 0.10.0, `former-supervisor` on both sides and `adversary` answered by `antagonist`, warn instead: `<file> relationship <type> to <target> has backlink <types>, a pairing from before story-skills 0.10.0; change the backlink to <expected>`
- character `locations` and location `notable-characters`, which must list each other
- location `routes`, whose `to` must name another existing location
- chapter `choices`, whose `to` must name an existing chapter or a scheduled `chapter-NN` not written yet. In a branching book (one where any chapter has choices), a chapter that no path of choices from the first chapter reaches is a warning: `chapters/chapter-05.md cannot be reached: no choice path from chapter-01 leads to it`
- a character's `died-in` and `revived-in` chapters
- the `from` chapter of each progression on a character, location, or faction, which may be a scheduled `chapter-NN` with no chapter file yet
- arc characters, faction members and locations, and artifact owners and locations
- chapter and scene POV, `characters`, `mentions` (a character or an artifact), locations, and `arcs-advanced`, and each scene's chapter
- the chapter, character, and arc ids in questions, promises, and clues, and the `used-in` chapters of research notes. A promise or clue `payoff`, its `planted` while `status: planned`, an `open` question's `introduced`, and a research note's `used-in` may name a scheduled `chapter-NN` that has no chapter file yet, unless its number is 0 or belongs to an existing chapter under another id (`chapter-1` beside `chapter-01`)
- chapter ids and markdown links in the bodies of `plot/timeline.md` and arc files, and markdown links in the bodies of `matter/` pages
- the `follows` and `precedes` links in `story.md`, which must point at story projects that link back

With `characters/old-bram.md` listing two locations, where `dock-nine` does not exist and `gull-harbour` does not list Bram back:

```yaml
locations:
  - dock-nine
  - gull-harbour
```

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

Runs the deterministic continuity engine over frontmatter: characters appearing after they die (by `died-in`, or by a status [progression](project-format.md#progressions) to `deceased`, resolved in story order), status progressions that contradict `died-in` or `revived-in`, promises and clues paid off before they are planted, questions resolved before they are introduced, planted setups with no payoff, open questions left unanswered for twelve or more drafted chapters, POV characters missing from a chapter's cast or from all of its scenes, `status: cut` characters still listed in a cast, arc, or relationship, destroyed or lost artifacts used later, impossible clock and travel times (including journeys faster than the shortest path through location `routes`, and a character at two different places at the same exact time), and references in `continuity/state.md`. Findings matching an entry in `continuity/exemptions.md` are reported as `dismissed` and do not fail the run; an entry matches by the finding's `code`, `file`, `chapter`, or text.

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
warning: chapters/chapter-03.md POV character nessa-thorn is not listed in characters [pov-not-in-cast]
warning: continuity/promises/the-sealed-letter.md was planted in chapter-01, 3 chapters ago, and has no payoff yet [promise-unpaid]
warning: continuity/state.md object-state[0] status active conflicts with worldbuilding/artifacts/vales-compass.md status destroyed [state-status-conflict]
```

Routes are declared on locations, with the fastest journey time in hours. A route is two-way unless the destination declares its own route back. In The Salt Road, with this on `gull-harbour`:

```yaml
routes:
  - to: saltmere
    hours: 30
    mode: salt wagon
```

a `saltmere` location, and a second scene that puts Ilse in Saltmere on the evening of the same day as the 06:30 scene at the harbour (both created with `story add scene`, which also adds `saltmere` to the chapter's `locations`):

```text
$ story continuity
Continuity check failed: 1 errors, 0 warnings, 0 dismissed
error: scenes/chapter-01-scene-02.md puts ilse-varrow at saltmere at most 15.4h after scenes/chapter-01-scene-01.md at gull-harbour, but the fastest route takes 30h
```

A named time such as `evening` covers a span of the clock, so the gap is measured at its most generous reading ("at most 15.4h": `evening` runs to 21:59). Only a journey that is impossible on every reading is reported.

Every rule, and how to write exemptions, is in [Continuity and analysis](continuity.md#story-continuity).

### knowledge

```text
story knowledge <character-id> --at <chapter-id> [--path <project>]
```

Lists the `knowledge-state` entries in `continuity/state.md` that a character knew by a given chapter, using the same rule as [`context`](#context). An entry counts when its `learned-in` chapter is not after `--at` in story time (by story date when both chapters are dated, else by chapter number); an entry with no `learned-in` is pre-existing knowledge and always counts. Each line is marked `reader-knowledge` when the learning chapter's number is at or before `--at` (the reader has been shown it, or it is pre-existing) and `character-knowledge` with `do not reveal` when the character learned it in a later chapter that is earlier in story time (a flashback the reader has not reached). A fact learned later in story time is left out, including one the reader already read in a flash-forward. It exits 3 with the parse error when a chapter file, the character file, or `continuity/state.md` fails to parse, and when one of the character's entries has no `knows`.

| Option | Effect |
|---|---|
| `--at <chapter-id>` | Required. The chapter to ask about |
| `--path <path>` | Project root (default: current directory) |

In [`examples/harbor-of-second-light`](../examples/harbor-of-second-light/):

```shell
story knowledge mara-quill --at chapter-01
```

```text
- the Afterimage Archive was active during the Blackout Night (reader-knowledge, learned in chapter-01)
```

In [`examples/the-last-ember`](../examples/the-last-ember/):

```shell
story knowledge kael-voss --at chapter-01
```

```text
- The tunnels from the Vale side reach the Whisper Gate into the High Keep (reader-knowledge, pre-existing)
```

After the knowledge, it prints the character's [progressions](project-format.md#progressions) that apply by that chapter, oldest first, each with the value it replaced. A progression from the `--at` chapter itself counts. A character with `status: alive` and a progression `from: chapter-02` to `missing` prints, at `chapter-03`:

```text
No recorded knowledge for mara-finn at chapter-03
State at chapter-03:
- status: missing (from chapter-02, was alive)
- scar: jaw to collarbone (from chapter-03)
```

With `--json`, `data` holds `character`, `at`, and `entries` (each `knows`, `learnedIn`, and `audience`). `audience` is `reader` or `character`, matching the line's mark. It also holds `state`, the character's frontmatter with the applied progressions and without `progressions`, and `changes`, one `{ field, value, from, previous }` per applied progression, oldest first. `previous` is absent when the field was not set before.

With nothing recorded, it prints `No recorded knowledge for <id> at <chapter-id>` and exits 0. A missing argument or an unknown character or chapter exits 2; a character file that fails to parse exits 3. A broken character file prints its parse error, such as `characters/mara.md: is missing YAML frontmatter`, rather than `Unknown character`:

```text
$ story knowledge kael-voss
Usage: story knowledge <character-id> --at <chapter-id> [--path <project>]

$ story knowledge nobody --at chapter-01
Unknown character nobody

$ story knowledge kael-voss --at chapter-09
Unknown chapter chapter-09
```

### context

```text
story context <chapter-or-scene-id> [--budget <tokens>] [--scenes <n>] [--json] [--path <project>]
```

Prints, as markdown, the slice of the project an agent needs to draft one chapter or scene, packed into a token budget. It reads files and writes nothing. Items are added in this priority order:

1. **Target**: the chapter or scene's POV, cast, mentions, locations, arcs, date, outcome, hook, and `target-words`, the chapter's `## Outline` (up to the `---` rule above the prose), and the chapter's planned scenes or, for a scene, its `## Purpose`.
2. **Story essentials**: first the book's language contract from `story.md`: `language` (`en` when unset), `writing-mode` (`horizontal` when unset), `chapter-numerals` (`western` when unset), and `count-unit` (the unit lengths are counted in, including the one `language` implies). These belong to the book, not to a chapter, so they are included at every target, and they are a separate small item, so a budget too small for the rest of `story.md` still packs them. Then `story.md` genre, setting era, POV, tense, form, themes, and `premise`, plus its `## Tone & Style`, `## Setting`, and `## Central Conflict` sections; then `style-sheet.md`, when present: `dialect`, `preferred`, `watch-words`, and its body.
3. **POV knowledge and state**: the POV character's `knowledge-state` entries known at the target (those the reader has not been shown come next, as their own item under `### What <name> knows that the reader has not seen (do not reveal)`, id `hidden-knowledge:<id>` with `--json`, so they never crowd out the rest and can be removed whole), the `character-state` entry from `continuity/state.md` when its `current-chapter` is before the target, the `state-changes` of earlier scenes whose `character` is the POV character or whose `owner` hands them an artifact, and the POV character's [progressions](project-format.md#progressions) applied by the target.
4. **Characters on the page**: a card for the POV character and each character in the target's `characters`: role, status at the target, aliases, `voice-words`, `voice-avoid`, the progressions applied by the target, and the `## Appearance`, `## Personality & Traits`, `## Motivations & Goals`, and `## Voice & Speech Patterns` sections.
5. **Where it happens**: each of the chapter's `locations`, or the scene's `location`, with its type, region, status, and `controlled-by` after its progressions, and the progressions applied.
6. **Open promises, clues, and questions**: each one planted or introduced by the target chapter and not paid off or resolved before it, with its `## Setup`, `## Clue`, or `## Question` section. Those planted, raised, paid off, or answered in the target chapter itself say so; `dropped` and `abandoned` ones are left out.
7. **Previous scenes**: the `--scenes` scene records just before the target, each with its POV, location, outcome, and `## Purpose`.

Threads, scenes, and progressions dated to a chapter after the target in reading order (chapter number) are left out, so the context does not spoil what comes later. A thread or scene whose chapter is later or unknown is left out. Progressions count only from chapters read by the target (a planned `chapter-NN` by its number) and are then applied in story time, as `story knowledge` applies them; a progression that dates an alias is how to keep a later alias off earlier cards. Knowledge uses the same rule as [`knowledge`](#knowledge): a fact is included when the character knows it in story time, and each line is marked `reader-knowledge` or `character-knowledge`. A fact learned in a flash-forward read earlier is not known yet, so it is left out. A fact learned in a flashback the reader has not reached is included and marked `character-knowledge` with `do not reveal`: the character knows it, and the draft must not state it. That chapter's prose, outline, and other entries stay out. The sections that tend to describe the future are never read: the `story.md` synopsis and notes, a character's backstory, arc, and timeline, and the payoff, evidence, and resolution plans of promises, clues, and questions. A character's status is the one at the target: one who dies in the target chapter shows `dies in this chapter`, and one who died earlier shows `deceased (died in <chapter>)`. A `died-in` chapter that is still `outline` is planned, not in force, so a later chapter shows the character as `alive`. A character whose `died-in` chapter comes later, or does not exist yet, shows as `alive`; in a flash-forward set after that death the status is left out, and so is a `deceased` status with no `died-in` and a status a later-read `revived-in` would change. A scene with no `pov` of its own uses its chapter's. Sections still holding the starter text `story add` and `story init` write, including the starter outline and style sheet, are skipped. For a scene target, threads and deaths dated to the target chapter are marked as happening in this chapter, since the project does not record which scene. A fact whose `learned-in` is the target chapter is included only when an earlier scene's `state-changes` records it for the POV character, matched by `fact` id or by the same text aside from case, spacing, and a trailing full stop or exclamation mark, and it then reads `reader-knowledge, learned in this chapter, scene N`. Drafting the chapter still includes every fact known by the end of that chapter (`reader-knowledge, learned in this chapter`).

The budget is an estimate, not a tokenizer count. Chinese, Japanese, Thai, Lao, Khmer, and Burmese are split into words as [`wordcount`](#wordcount) splits them: one word per Chinese or Japanese character, and a dictionary word for Thai, Lao, Khmer, and Burmese. Everything else, including punctuation between those words, counts as whitespace-separated runs. An item costs the sum of those words' rates, rounded up once: 4 tokens per 3 words in spaced text, 2 per 3 Han or katakana characters (the katakana long-vowel mark included), 1 per 2 hiragana, and 1 per Thai, Lao, Khmer, or Burmese word. Spaced text on its own still costs `ceil(words × 4 ÷ 3)`. The headings between sections are not counted. Items are packed whole in the order above. One that does not fit is left out, a later, smaller one may still fit, and every item left out is listed at the end with the file to read instead. Previous scenes are packed nearest first and printed in reading order.

| Option | Effect |
|---|---|
| `--budget <tokens>` | Token budget, a positive integer (default `6000`) |
| `--scenes <n>` | How many earlier scenes to summarise, `0` or more (default `5`) |
| `--json` | Print the context as a JSON result (see below) |
| `--path <path>` | Project root (default: current directory) |

In [`examples/the-unraveled-thread`](../examples/the-unraveled-thread/), with a small budget:

```shell
story context chapter-02 --budget 200
```

```text
# Drafting context: chapter-02

Chapter 2: The Millpond. About 197 of 200 tokens
(estimated at 4 tokens per 3 words in spaced text; 2 per 3 Han or katakana characters, 1 per 2 hiragana, and 1 per Thai, Lao, Khmer, or Burmese word). Later chapters are left out. A fact marked character-knowledge is known in story time; do not reveal it.

## Target

### Chapter 2: The Millpond
- POV: Jonas Reed (jonas-reed)
- On the page: Jonas Reed (jonas-reed), Edran Vale (edran-vale)
- Locations: the-mill-row
- Arcs advanced: the-ledger-trail
- Hook: decision

Scenes planned:

1. The Millpond (outcome: no-and)

## Story essentials

### Language contract
- Language: en
- Writing mode: horizontal
- Chapter numerals: western
- Count unit: words

### The Unraveled Thread
- Genre: mystery / village-noir
- Setting era: 1920s
- POV: third-person-limited
- Tense: past
- Form: novel
- Themes: guilt, small-town secrets

## Characters on the page

### Jonas Reed (POV)
- Id: jonas-reed
- Role: protagonist
- Status: alive

### Edran Vale
- Id: edran-vale
- Role: supporting
- Status: dies in this chapter

## Where it happens

### The Mill Row
- Id: the-mill-row
- Type: district
- Status: unknown

## Open promises, clues, and questions

- **The Sealed Letter** (promise; planted in chapter-01)

## Previous scenes

- **chapter-01 scene 1: The Ash and the Ledger** (POV jonas-reed, at the-mill-row, outcome yes-but)

## Left out to fit the budget

Read these files directly if you need them:

- Clue: Edran's Margin Notes: continuity/clues/edrans-margin-notes.md (about 48 tokens)
- Clue: The Constable's Silence: continuity/clues/the-constables-silence.md (about 34 tokens)
```

The chapter's outline is still the starter text `story add` writes, so it is skipped. The Burned Page, The Broken Compass, and Who Burned The Mill are left out because they are planted or raised in chapter 3, and Jonas's knowledge of the firestarter's page because its `learned-in` chapter does not exist.

`--budget` and `--scenes` can be set for every run with `story.md` [`cli-defaults`](#defaults-and-severity-from-storymd); a flag on the command line wins.

With `--json`, `data` holds `target` (`kind`, `id`, `chapter`, `number`, `title`), `budget`, `estimatedTokens`, `sections` (each `id`, `title`, and every candidate item as `{ id, label, source, text, tokens, included }`, so a script sees what the budget left out), `omitted`, and `warnings`. `source` names the project files the item draws on, comma-separated. Each warning is also a `warning` diagnostic.

It exits 2 with `Unknown chapter or scene <id>` for an id that is neither, with the usage line when the id is missing, and on a `--budget` that is not a positive integer or a `--scenes` that is not a whole number. A chapter file, `continuity/state.md`, or the target scene's file that fails to parse stops it with the parse error and exit 3, because the spoiler filter depends on them, and so does a scene whose chapter does not exist; any other file that fails to parse is left out with a `warning:` line on stderr.

### compare

```text
story compare [path] (--ref <git-ref> | --against <path>) [--anchor <label>...]
```

Compares the current chapters with an earlier draft and reports word changes per chapter, chapters added and removed, and the share of each changed chapter's paragraphs that are unchanged. With `--anchor`, it instead finds where paragraphs a reader cited in an earlier review copy are now. You must give exactly one source for the earlier draft.

| Option | Effect |
|---|---|
| `--ref <git-ref>` | Read the earlier chapters from a git branch, tag, or commit (with `~` and `^` suffixes); any name git accepts works, except one starting with `-`. The project must be inside a git repository, and its folder must exist at the ref. It reads with `git show` and never writes to the repository |
| `--against <path>` | Read the earlier chapters from another copy of the project on disk, resolved against the current directory. It must be a story project with a `story.md` |
| `--anchor <label>` | A paragraph label from a review copy of the earlier draft, such as `ch03-p12` (repeatable). Prints where each paragraph is in the current text instead of the chapter comparison |

Chapters are matched by id (`chapter-01`, `chapter-02`, and so on), except that a chapter whose paragraphs match a chapter under another id better is paired with it and listed as `chapter-03 Title (moved from chapter-02): ...`, and the summary line adds `N moved`. That is how chapters renumbered by [`move`](#move) show up. A pair under different ids needs at least half the paragraphs of the longer version to match word for word. With `--ref`, old drafts without frontmatter are still compared. Every file in the current project, and with `--against` in the other project, must parse, or `compare` stops with an error. A chapter is `unchanged` only when its paragraphs are the same and in the same order; scene-break lines and code between closed fences are not compared.

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

#### Mapping review-copy labels

A [review copy](#build) label is the paragraph's position in that build, so edits earlier in the chapter move it. `--anchor` labels both versions exactly as `build --format html` does, finds each label's paragraph in the earlier draft, and looks for it in the current text: first the same text (the nearest copy, preferring the same chapter), then the most similar paragraph by shared words (at least half; Chinese and Japanese share characters, and Thai, Lao, Khmer, and Burmese are split into words as [`wordcount`](#wordcount) splits them), else it reports the paragraph as not found with its first few words so you can search for it. With `--ref`, the project's markdown at that ref is copied to a temporary directory, read, and removed; nothing is written to the repository. It prints one line per label and exits 0 unless a version cannot be read; an unknown label is reported, not an error. Both versions must build, as `build` requires.

After adding a sentence as a new paragraph early in chapter 1 of *Harbor of Second Light*, rewording one paragraph, and deleting another:

```shell
story compare . --ref beta-round-1 --anchor ch01-p1 --anchor ch01-p2 --anchor ch01-p3 --anchor ch01-p20 --anchor ch09-p3
```

```text
ch01-p1 -> ch01-p1 (text unchanged)
ch01-p2: not found in the current text ("Mara heard it through thirty feet…")
ch01-p3 -> ch01-p3 (edited, 80% similar)
ch01-p20 -> ch01-p20 (text unchanged)
ch09-p3: no such label in git ref beta-round-1
Comparison complete: 0 errors, 0 warnings, 0 dismissed
```

Errors:

```text
$ story compare
compare needs exactly one of --ref <git-ref> or --against <project-path>

$ story compare --ref main
compare --ref needs the project inside a git repository

$ story compare "renamed book" --ref v1
renamed book/ does not exist at git ref v1

$ story compare examples/the-last-ember --ref no-such-tag
Unknown git ref: no-such-tag
```

### similarity

```text
story similarity [path] --against <file|folder|git-ref> [--min-words <n>] [--json]
```

Finds passages of chapter prose that share a run of words with other text: your earlier books, a previous draft, or a source a passage might echo too closely. It is advisory. A shared run is a place to look, not a finding of copying: a stock phrase, a quotation you meant, or your own recurring line all share words. Each passage is a `similarity-shared-passage` warning, so the command exits 0 unless a `severity` entry promotes it.

| Option | Effect |
|---|---|
| `--against <file\|folder\|git-ref>` | The text to compare with. On the command line it is resolved against the current directory; set in `story.md` [`cli-defaults`](#defaults-and-severity-from-storymd), against the project folder. A symlink you name is followed. A **file** is read as UTF-8 text; a markdown file loses its frontmatter, and a chapter file keeps only its `## Chapter Text`. A **folder** contributes the chapters of each story project in it (the folder itself when it holds `story.md`, or one nested inside), and every other `.md`, `.markdown`, and `.txt` file. Hidden files, `dist/`, `node_modules/`, and symlinks inside are skipped. A name that is neither is tried as a **git ref**, and the project's own chapters at that commit are the reference, read the way `compare --ref` reads them. An existing path wins over a ref of the same name; write `refs/heads/main` to mean the branch. This project, and its own chapter files, are never a reference |
| `--min-words <n>` | The shortest shared run to report, in words; default `8`, at least `5`. A `story.md` [`cli-defaults`](#defaults-and-severity-from-storymd) entry can set it |

Both sides are split into words and compared lowercased, with punctuation dropped and curly apostrophes folded. So `"The tide, turning,"` matches `the tide turning`, and `lamp-keeper` matches `lamp keeper`. A hyphenated word counts as two here, so the word totals can differ from [`wordcount`](#wordcount). Chinese and Japanese are compared a character at a time, and Thai, Lao, Khmer, and Burmese a word at a time, split as [`wordcount`](#wordcount) splits them. Every run of `--min-words` words in the reference is indexed. Each run a chapter shares with the index is followed as far as the two texts agree. The longest runs are reported first. A shorter run that overlaps one keeps only the words not already reported, and only if at least `--min-words` of them are left, so each word is reported once.

A passage is located by the paragraph labels the [review copy](#build) uses (`ch02-p1`), in the chapter and, for a story project or git ref, in the reference. A plain file's paragraphs are numbered `p1`, `p2`, and so on, split at blank lines, and so are a project's chapters when it could not be built (two chapters numbered 3, say). A passage that crosses paragraphs names both labels (`ch02-p3 to ch02-p4`) and joins their text with ` / `. Front and back matter is left out: an epigraph or quoted lyric belongs on the permissions pass in the `editorial-review` skill, not here.

The report lists each chapter's shared passages and words, then the total. Percentages are rounded down to a tenth, so one shared line in a long book shows as `0.1%`, never `0%`. The warning lines quote up to 24 words of each passage; `--json` gives the full text of both sides in `data.passages`. It stays fast on a whole novel. A 150,000-word manuscript against 300,000 words of reference takes under a second.

With `../sources/parish-notes.txt` holding a transcribed register entry, in a copy of *The Unraveled Thread*:

```shell
story similarity --against ../sources
```

```text
Similarity against ../sources: 25 words in 1 file, runs of 8 or more shared words

- chapters/chapter-01.md: no shared passages
- chapters/chapter-02.md: 1 shared passage, 9 words (29%)
- chapters/chapter-03.md: no shared passages
- chapters/chapter-04.md: no shared passages

Total: 9 of 111 words shared (8.1%)
Shared text is a place to look, not proof of copying: check each passage in context.
Similarity check complete: 0 errors, 1 warnings, 0 dismissed
warning: chapters/chapter-02.md (ch02-p1) shares 9 words with ../sources/parish-notes.txt (p2): "was pulled from the millpond on a grey Tuesday" [similarity-shared-passage]
```

Against an earlier draft, `story similarity --against beta-round-1` shows what survived the revision word for word. For a chapter-by-chapter count of changes, use [`compare`](#compare).

Errors:

```text
$ story similarity
similarity needs --against <file|folder|git-ref>: the text to compare the chapters with

$ story similarity --against .
similarity --against . is this project: point it at other text, or at a git ref for an earlier draft

$ story similarity --against no-such-thing
similarity --against no-such-thing is not a file or folder, and no git ref has that name

$ story similarity --against ../notes --min-words 3
--min-words must be a whole number 5 or more, such as 8
```

### progress

```text
story progress [path] [--log] [--date <YYYY-MM-DD>]
```

Reports the manuscript word count against `target-words` in `story.md`, the days left to `deadline` and the words a day needed to meet it, per-chapter `target-words`, and pace from the session log in `progress.md`.

A book [counted in characters](project-format.md#counting-in-characters) reports characters against `target-characters` instead (`Progress: 52,300 of 120,000 characters (43.6%)`), and `--log` records `characters` beside `words` in the session. In `--json`, `data.unit` is `words` or `characters`. `words` is the word count in every book, and `characterCount` (top level, `logged`, each chapter, and `lastSession`) the character count, or null in a book counted in words; `target`, `percent`, `remaining`, `perDay`, `since`, and `pace` are in the unit. Sessions logged with no `characters` are left out of the pace and reported as a `session-without-characters` warning.

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
- **Character presence**: how many chapters each character appears in (in `characters` or as `pov`, on the chapter or a scene), their longest absence, and whether they drop out before the end.

`timeline` reports no findings of its own; clock errors belong to `continuity`.

On a separate copy of the Salt Road project (see [Example projects used on this page](#example-projects-used-on-this-page)), after adding a second chapter with a flashback scene dated twelve years earlier. Later examples on this page use the one-chapter project:

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
story prose [path|-]
```

An advisory prose lint. For each chapter it reports sentence count, average and longest sentence length and their spread, filter words and `-ly` adverbs per 1,000 narration words, dialogue tags and said-bookisms, words echoed within 30 words, and watch words and avoided spellings from `style-sheet.md`. Across the manuscript it lists repeated four-word phrases and characters with similar first names. Like `wordcount`, it ignores code between closed `` ``` `` fences.

Style findings are warnings, so `prose` exits 1 only when a file's frontmatter fails to parse, or when a `severity` entry in `story.md` promotes a prose warning to an error (see [Defaults and severity from story.md](#defaults-and-severity-from-storymd)).

The word lists (filter words, `-ly` adverbs and their exceptions, dialogue tags and said-bookisms, echo and phrase stopwords, British and American spellings) come from the language pack for `story.md` `language`, changed by the style sheet's `add-words` and `replace-words` (see [Word lists](project-format.md#word-lists)). English, Spanish, French, and German have them; German has no adverb ending, so its `adverbs` check is skipped, and Spanish and French count `-mente` and `-ment` adverbs. In another language, each check whose list the pack lacks is skipped rather than run with English words: `filter-words`, `adverbs`, `dialogue-tags`, `echoes`, `repeated-phrases`, plus `dialect-spellings` when the style sheet sets a `dialect` and `signature-words` when a baseline is on. The text output prints `Note: Filter words skipped: no filterWords list for language it` under the heading for each one and leaves its line out, and `--json` lists them in `data.skipped` as `{ check, language, missing, message }` (`[]` for English), and `data.language` gives the tag. A baseline leaves the skipped measures out of its text, and `--json` sets them to `null`: `filterPerThousand`, `adverbsPerThousand`, and `signatureWords` in `data.baseline`, and the matching figures and `signatureWordsUsed` in `chapters[].baseline`. Skipping never changes the exit code. See [Books not in English](continuity.md#books-not-in-english).

Three flags change the warning thresholds. Each takes a number 0 or more; set them for every run with `cli-defaults` in `story.md`.

| Flag | Warns when a chapter has more than | Default |
|---|---|---|
| `--max-filter-words <n>` | `n` filter words per 1,000 narration words | 10 |
| `--max-adverbs <n>` | `n` `-ly` adverbs per 1,000 narration words | 12 |
| `--max-bookisms <n>` | `n` said-bookism dialogue tags (a whole number) | 2 |

#### Comparing with your own prose

The fixed limits suit a generic writer. List files or folders of your own prose (earlier books, chapters you are happy with) as `samples` in `style-sheet.md`, and `prose` compares each chapter with them instead:

```yaml
samples:
  - ../book-one
  - research/approved-chapter-drafts
```

Each entry is a path relative to the project folder. A folder holding `story.md` contributes its chapters, and any other folder its `.md`, `.markdown`, and `.txt` files (not `_index.md` registries), as [`similarity --against`](#similarity) reads them. This project's own chapters are never a sample: they are what is compared, so an entry naming the project or its `chapters/` warns `style-sample-own-chapters`. From all the samples together `prose` builds a profile:
- average sentence length and its spread;
- average paragraph length;
- the share of words inside dialogue;
- filter-word and `-ly` adverb rates per 1,000 narration words;
- the 20 content words the samples use most, their signature words.

The report prints the profile, and each chapter's paragraph length, dialogue share, and how many signature words it uses. It warns when a chapter of 300 or more words drifts from the profile further than these tolerances, in either direction (the two rates also need 300 narration words, so a chapter that is nearly all dialogue is compared on its dialogue share):

| Measure | Tolerance | Code |
|---|---|---|
| Average sentence length (chapters with 10 or more sentences) | 30% of the samples' average | `prose-baseline-sentences` |
| Average paragraph length | 50% of the samples' average | `prose-baseline-paragraphs` |
| Share of words in dialogue | 20 percentage points | `prose-baseline-dialogue` |
| Filter words per 1,000 narration words | Half the samples' rate, at least 3 | `prose-baseline-filter-words` |
| `-ly` adverbs per 1,000 narration words | Half the samples' rate, at least 3 | `prose-baseline-adverbs` |

With a baseline, the fixed `--max-filter-words` and `--max-adverbs` warnings are off: your own rate is the measure. Said-bookisms, uniform sentences, spellings, and similar names are checked as before. The samples need at least 2,000 words of narration. With fewer, `prose` warns `prose-baseline-small` and keeps the fixed limits. A sample entry that names nothing warns `style-sample-missing`, one that cannot be read (not UTF-8, say) warns `style-sample-unreadable`, and the rest are used. Signature words leave out the names in this project's bible, but not names from another book's cast.

The baseline is on whenever `samples` lists something. `--baseline false` (or `baseline: false` in `cli-defaults`) turns it off for a run, and `--baseline` with no samples is a usage error. A drift is a prompt to reread the chapter, not a rule: a fight scene should run shorter than the book's average. `--json` adds the profile as `data.baseline` (or `null`) and each chapter's figures as `chapters[].baseline`.

`story prose -` lints a passage from stdin instead of the chapters, with the style sheet, samples, and character names of the project given by `--path` or the current directory (and the default rules outside a project). The passage is reported as `stdin`, and similar character names, a bible finding, are left out. A whole chapter file can be piped: its frontmatter is skipped and only its prose (the text under `## Chapter Text`) is linted, as for a chapter in the project. A chapter or scene file in the project that fails to parse does not fail a passage check, since the passage stands in for them; a broken style sheet or character file still does.

On [`examples/the-last-ember`](../examples/the-last-ember/), with a five-sentence draft scene:

```shell
story prose - --path examples/the-last-ember < draft-scene.md
```

```text
Prose report: passage from stdin, 32 words

stdin: passage (32 words)
  Sentences: 5, average 6.4 words, longest 15, spread 4.6
  Filter words: 107.1 per 1k narration words (felt 1, knew 1, saw 1)
  -ly adverbs: 35.7 per 1k narration words (slowly 1)
  Dialogue tags: said 1; said-bookisms: none
  Echoes within 30 words: none
  Watch words: almost 1, something 1

Passage:
  Repeated 4-word phrases: none
Prose check complete: 0 errors, 0 warnings, 0 dismissed
```

```shell
story prose
```

```text
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

Prints a project summary: metadata (with a `Form:` line when `story.md` sets `form`), entity counts, total words (and percentage of `target-words`, when set), a line per chapter and arc, and the result of `validate`, `links`, and `continuity`. A book [counted in characters](project-format.md#counting-in-characters) gives total characters against `target-characters` and each chapter's characters; In `--json`, `data.unit` is the count unit, and `targetCharacters`, `counts.characterCount` (the prose, not `counts.characters`, the cast), and each chapter's `characterCount` sit beside the word counts, null in a book counted in words. A metadata field that `story.md` does not set, such as `status` or `pov`, prints as `unset`, and a missing `title` shows the project folder name.

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
- [P2] Draft chapter 2: Use story add chapter "Chapter 2" --number 2, then outline scenes to advance Sera's Reclamation.
- [P3] Project is mechanically healthy: No deterministic maintenance issues are blocking the next writing pass.
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
| `P1` | Review continuity warnings, refresh stale word counts, add scene records for chapters without them, reconcile `mode: discovered` chapters that have no `## Chapter Notes (post-hoc)` heading; when `story.md` has `status: revising`, plan revision passes or work the next one |
| `P2` | Track open questions, review pending promises and open clues, draft the next chapter, create a first character |
| `P3` | Nothing is blocking the next writing pass |

Actions are sorted by priority, P0 first; actions with the same priority keep the order the checks produce them. The draft-next-chapter action names the first chapter that exists but has no prose yet (0 words, such as a fresh outline), `[P2] Draft chapter 1: chapters/chapter-01.md has no prose yet (status outline): draft it under ## Chapter Text to ...`, and only when every chapter has prose does it suggest adding the next number with `story add chapter`. It is left out when `story.md` has `status: revising`, `status: complete`, or `status: abandoned`, or when every arc is `resolved`. A discovered chapter without post-hoc notes gets `[P1] Reconcile discovered chapters: Run the discovery-drafting reconcile loop and add ## Chapter Notes (post-hoc) for <ids>.`

Suggested commands use the project path as you typed it, or `.` when you gave none: `story next drafts/salt-road` suggests `Run story continuity drafts/salt-road and ...` and `story passes drafts/salt-road --init`.

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
- [P2] Review open clues: 1 clues are still planned or planted.
- [P2] Draft chapter 5: Use story add chapter "Chapter 5" --number 5, then outline scenes to advance The Ledger Trail.
```

On a book with `status: revising`, `next` points at the revision pass in progress, or the first one not done, with the commands that help with it. With no passes recorded it suggests `story passes --init` instead. In The Salt Road, after fixing the journey error from [continuity](#continuity) and with the structure pass done (see [passes](#passes)):

```text
# Next Writing Actions: The Salt Road

Checks: validate ok (0 errors, 1 warnings), links ok (0 errors, 0 warnings), continuity ok (0 errors, 0 warnings)

Actions:
- [P1] Revision pass: character: Wants, arcs, motivation, and who knows what when. Run story voices, story knowledge <id> --at <chapter>, story diagram relationships. Mark it with story passes --done character.
- [P2] Review open clues: 2 clues are still planned or planted.
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
- [P2] Review open clues: 1 clues are still planned or planted.
- [P2] Draft chapter 5: Use story add chapter "Chapter 5" --number 5, then outline scenes to advance The Ledger Trail.
```

## Craft and revision commands

These commands read chapters, scenes, and the story bible to answer craft questions: is the pacing slack, do the clues play fair, do the characters sound different, is a new name safe to use. They never change story files. Their findings are advisory warnings, except `names`, which reports an exact clash as an error. `diagram --out` writes only the file you name, and `passes` writes only the `revision-passes` entry in `story.md`.

The rules behind each report, and how to act on them, are in [Continuity and analysis](continuity.md).

### pacing

```text
story pacing [path]
```

A pacing dashboard built from frontmatter. For each chapter it shows the prose word count (characters in a book [counted in characters](project-format.md#counting-in-characters), which the long and short chapter findings then measure; in `--json`, `data.unit` is the count unit, and each row's `characterCount` and `medianCharacterCount` sit beside `words` and `medianWords`, null in a book counted in words), the number of scenes and sequels (scene records with `sequel: true`), the tally of scene `outcome` values, and the chapter-ending `hook`. Record outcomes with `story add scene --outcome` and hooks with `story add chapter --hook` (see [add](#add)), or edit the fields by hand.

| Field | Values |
|---|---|
| Scene `outcome` | `yes` (the POV character gets what they want), `no`, `yes-but` (a win with a cost), `no-and` (a loss that makes things worse) |
| Chapter `hook` | `cliffhanger`, `question`, `revelation`, `reversal`, `decision`, `emotional`, `resolution` |

It warns about:

- a chapter with `draft`, `revised`, `final`, or `complete` status and no `hook`
- three or more scenes in a row, in reading order, that end in an outright `yes`
- four or more scenes in a row with no sequel between them
- three or more chapters in a row that end on `resolution`
- with three or more written chapters, a chapter over twice or under half the median length

Sequels are left out of the outcome counts. `pacing` exits 1 only when a file fails to parse.

On a copy of [`examples/the-unraveled-thread`](../examples/the-unraveled-thread/):

```shell
story pacing
```

```text
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

### clues

```text
story clues [path]
```

Shows every clue as a row in a grid of chapters, marking where it is planted (`P`), revealed (`R`), or both (`x`). Red herrings are marked `~`, and each row ends with the clue's status and `delayed` when `significance-delayed` is true.

For clues whose status is `planned`, `planted`, or `paid-off`, it warns when:

- a clue is revealed but never planted
- a clue is planted in the same chapter as its reveal, or the chapter before
- a clue lists no `characters` who could notice it
- a red herring (`red-herring: true`) has no `payoff` chapter that debunks it
- three or more genuine clues are live and none is `significance-delayed`

Ordering errors, such as a reveal before its plant, belong to `story continuity`. `clues` exits 1 only when a file fails to parse. Mark a red herring with `story add clue --red-herring`.

On a copy of [`examples/the-unraveled-thread`](../examples/the-unraveled-thread/):

```shell
story clues
```

```text
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

With no clues it prints `- None: add clues with story add clue "Name" --planted chapter-02 --payoff chapter-09`.

### voices

```text
story voices [path|-]
```

Builds a dialogue fingerprint for each character who speaks: lines and words of dialogue, average sentence length, contractions per 100 words, the share of questions and exclamations, and up to five signature words (words the character uses at least twice, at more than twice the rate of the other speakers; common words are ignored). A line is attributed only when its paragraph names the speaker next to a speech verb (`"...," Mara said` or `said Mara`) or, failing that, when the narration names exactly one character and has no pronoun tag (`she said`, `said he`) right after a closing quote or right before an opening one. A pronoun and speech verb elsewhere in the paragraph (`She said nothing more`) is narration and does not block the action beat. Other quoted lines are counted as unattributed, never guessed. Names match a character's full name, given name, and `aliases`.

It warns when:

- a character says a word or phrase from their `voice-avoid` list
- a character with at least five lines never uses a word from their `voice-words` list
- two characters with at least five lines each have similar sentence length, contractions, questions, and exclamations

`voices` exits 1 only when a file fails to parse.

Speech verbs, pronouns, contractions, and stopwords come from the language pack for `story.md` `language`, changed by the style sheet's `add-words` and `replace-words` (see [Word lists](project-format.md#word-lists)). English, Spanish, French, and German have them, except contractions, which only English and German count. In a language without them the `speech-tags`, `contractions`, and `signature-words` checks are skipped: lines are attributed by action beats alone, `contractions` is `null` in `--json`, and the sound-alike comparison leaves contractions out. The text output prints a `Note:` line for each skipped check, and `--json` lists them in `data.skipped` (`[]` for English), and `data.language` gives the tag. See [Books not in English](continuity.md#books-not-in-english).

`story voices -` fingerprints the dialogue in a passage from stdin instead of the chapters, against the characters of the project given by `--path` or the current directory; outside a project it is an error. As for `prose -`, a broken chapter or scene file does not fail the check. Findings name the passage as `stdin`: `warning: kael-voss says "soldiers", which is in their voice-avoid list (stdin)`. The five-line thresholds still apply, so a short passage only reports `voice-avoid` words.

On a copy of [`examples/the-last-ember`](../examples/the-last-ember/), after adding `reckon` to `voice-words` and `soldiers` to `voice-avoid` in `characters/kael-voss.md` (as block lists; the parser does not read `[a, b]`):

```shell
story voices
```

```text
Voices: 1 speaking character, 35 unattributed lines

kael-voss: 9 lines, 76 words
  Sentence length 5.1, contractions 6.6 per 100 words, questions 7%, exclamations 0%
  Signature words: jumpy, good, looking, sera, soldiers
Voice check complete: 0 errors, 2 warnings, 0 dismissed
warning: kael-voss says "soldiers", which is in their voice-avoid list (chapter-01) [voice-avoid]
warning: kael-voss does not say "reckon" from their voice-words list in 9 attributed lines of dialogue [voice-words-unused]
```

With no attributed dialogue it prints `- None: tag dialogue with a character's name and a speech verb ("...," Mara said)`.

### names

```text
story names <name...> [--path <project>]
```

Checks one or more candidate names against every name in the story bible: characters (full name, given name, and `aliases`, skipping characters with `status: cut`), locations, factions, artifacts, systems, and glossary terms with their aliases. Quote a name that contains spaces. Each candidate gets one status line on stdout:

| Status | Meaning | Reported as |
|---|---|---|
| `taken` | The name, or its given name, matches an existing name or alias exactly (ignoring case and accents) | Error |
| `check` | It looks like an existing name (same first four letters, or one or two letters different), or shares an initial with a protagonist, antagonist, deuteragonist, or narrator | Warning |
| `clear` | No clash or look-alike | Nothing |

Titles such as `Lord`, `Captain`, or `The` are skipped when finding a given name, so `Lord Maren` is compared as `Maren`. The titles come from the language pack for `story.md` `language`; a language without a title list compares a name from its first word. `names` exits 1 when any candidate is `taken`, and with no names it prints its usage line and exits 2.

In The Salt Road:

```shell
story names "Ilsa" "Gull Haven" "Brannoc"
```

```text
Ilsa: check
Gull Haven: clear
Brannoc: clear
Names checked: 0 errors, 1 warnings, 0 dismissed
warning: "Ilsa" looks like character ilse-varrow (Ilse Varrow) [name-look-alike]
```

In [`examples/the-last-ember`](../examples/the-last-ember/):

```shell
story names "Sera" "Kaelan" "Marek" "Tamsin"
```

```text
Sera: taken
Kaelan: check
Marek: check
Tamsin: clear
Name check failed: 1 errors, 2 warnings, 0 dismissed
error: "Sera" clashes with character sera-voss (Sera)
warning: "Kaelan" looks like character kael-voss (Kael Voss) [name-look-alike]
warning: "Marek" looks like character lord-maren (Lord Maren) [name-look-alike]
```

### diagram

```text
story diagram <kind> [--out <file>] [--path <project>]
```

Prints [Mermaid](https://mermaid.js.org/) diagram source generated from frontmatter. The source is plain text, so it diffs cleanly and renders on GitHub and in most markdown editors. Regenerate it whenever the bible changes rather than editing it. Node ids are entity ids with hyphens turned into underscores; an id that is a Mermaid keyword, such as `end` or `graph`, gets `_node` appended.

| Kind | What it draws | Reads |
|---|---|---|
| `relationships` | Characters and their relationships: family links as solid edges drawn from the elder side, other relationships as dotted edges. Characters dead at the end of the book (by `died-in`, a status progression, or `status: deceased`, in story order, planned chapters included) are dashed (class `deceased`), and characters who died and came back have a thick outline (class `revived`) | Character `relationships`, `status`, `died-in`, `revived-in`, status `progressions` |
| `locations` | Locations with their region, and routes labelled with hours and mode; a one-way route uses an arrow | Location `region`, `routes` |
| `timeline` | The dated entries from `story timeline` (scenes, and chapters without scene records) in story order, grouped by date, marking entries told out of order | Scene and chapter `date`, `time` |
| `clues` | Chapters in order, with an edge from each clue's plant to its reveal; red herrings dotted, unrevealed clues pointing at a "not yet revealed" node | Clue `planted`, `payoff`, `red-herring`, `status` |
| `arcs` | Arcs linked to each chapter that advances them | Chapter and scene `arcs-advanced` |

| Option | Effect | Default |
|---|---|---|
| `--out <file>` | Write the source to this path, relative to the project root, instead of stdout. Project source paths are refused (see [Where commands write](#where-commands-write)) | Print to stdout |
| `--path <path>` | Project root | Current directory |

`diagram` prints and writes nothing while any project file fails to parse, because the diagram would silently drop entities; it reports the parse errors on stderr and exits 1. An unknown or missing kind exits 2:

```text
$ story diagram maps
Unknown diagram kind: maps. Supported kinds: relationships, locations, timeline, clues, arcs
```

In [`examples/harbor-of-second-light`](../examples/harbor-of-second-light/):

```shell
story diagram relationships
```

```text
flowchart LR
  ilya_venn["Councillor Ilya Venn"]
  mara_quill["Mara Quill"]
  theo_quill["Theo Quill"]
  ilya_venn -.-|"adversary"| mara_quill
  ilya_venn -.-|"former-supervisor"| theo_quill
  mara_quill ===|"sibling"| theo_quill
  classDef deceased stroke-dasharray: 4 4,color:#888
  class theo_quill deceased
```

```shell
story diagram locations --out dist/map.mmd
```

```text
Wrote locations diagram to ~/stories/harbor-of-second-light/dist/map.mmd
```

In The Salt Road, with the two dated scenes from [continuity](#continuity):

```shell
story diagram timeline
```

```text
timeline
  title The Salt Road
  section 1024-03-02
    06∶30 : The Harbour Bell
    evening : The Salt Gate
```

Mermaid's timeline syntax treats a colon as a separator, so colons in times and titles become `∶` (a ratio sign).

### passes

```text
story passes [path] [--init] [--start <pass>] [--done <pass>]
```

Shows the named revision passes recorded in `revision-passes` in `story.md`, and with an option, updates them. Revising in separate passes, each looking for one kind of problem, works from the largest problems to the smallest. The default ladder is:

| Pass | Focus | Commands that help |
|---|---|---|
| `structure` | Order of events, act turns, scenes that do not change anything | `story timeline`, `story pacing`, `story diagram arcs` |
| `character` | Wants, arcs, motivation, and who knows what when | `story voices`, `story knowledge`, `story diagram relationships` |
| `theme` | Premise, counter-premise, motifs, and the lie/truth arc | `story report` |
| `continuity` | Deaths, props, travel, promises, clues, and backlinks | `story continuity`, `story clues`, `story links` |
| `pacing` | Scene outcomes, sequels, chapter hooks, and chapter lengths | `story pacing` |
| `line` | Sentence-level clarity, rhythm, and distinct voices | `story prose`, `story voices` |
| `copyedit` | Spelling, usage, and consistency against the style sheet | `story prose` |
| `proof` | Typos and layout in the built book | `story build --format print`, `story build --format html` |

| Option | Effect |
|---|---|
| `--init` | Add every default pass that is missing, as `pending`, after any passes already recorded |
| `--start <pass>` | Mark a pass `in-progress`, adding it if it is new |
| `--done <pass>` | Mark a pass `done`, adding it if it is new |

Pass names are kebab-case; any name works, so you can add your own, such as `sensitivity-read`. Adding a name outside the default ladder prints a note on stderr, with a suggestion when the name is within two edits of a default pass, so a typo does not slip in unnoticed:

```text
$ story passes --start charcter
note: Added custom pass charcter, which is not in the default ladder; did you mean character?
Updated revision-passes in story.md
```

When a change is made, `passes` prints `Updated revision-passes in story.md` before the list. It rewrites only the `revision-passes` entry and refuses to change a `story.md` that fails to parse or has malformed passes. Without options it only reads. The next pass is the one in progress, or else the first one not done; `story next` suggests it when `story.md` has `status: revising` (see [next](#next)).

With no passes recorded, `passes` lists the default ladder and suggests `--init`. The suggested commands repeat the path you typed, so `story passes drafts/salt-road` suggests `story passes drafts/salt-road --init` and `mark it with story passes drafts/salt-road --done <pass>`; with no path, or `.`, they read `story passes`. In The Salt Road, after `story passes --init` and `story passes --done structure`:

```shell
story passes --start character
```

```text
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

`story.md` then holds:

```yaml
revision-passes:
  - pass: structure
    status: done
  - pass: character
    status: in-progress
  - pass: theme
    status: pending
  # ...and so on for the rest of the ladder
```

A name that is not kebab-case is refused:

```text
$ story passes --start Bad_Name
Revision pass names must be kebab-case, got Bad_Name
```

See [Writing workflows](writing-workflows.md) for where passes fit in a revision.

## Entity commands

`add`, `rename`, `move`, and `remove` take the project from `--path` (default: the current directory), because their positional arguments are the entity kind, id, and name. Each one reindexes the registries when it finishes.

### Entity kinds

| Kind | Accepted spellings | Directory | Id comes from |
|---|---|---|---|
| `character` | `character`, `characters` | `characters/` | The name, in kebab-case, or `--id` |
| `location` | `location`, `locations` | `worldbuilding/locations/` | The name, or `--id` |
| `system` | `system`, `systems` | `worldbuilding/systems/` | The name, or `--id` |
| `faction` | `faction`, `factions` | `worldbuilding/factions/` | The name, or `--id` |
| `artifact` | `artifact`, `artifacts` | `worldbuilding/artifacts/` | The name, or `--id` |
| `arc` | `arc`, `arcs` | `plot/arcs/` | The name, or `--id` |
| `chapter` | `chapter`, `chapters` | `chapters/` | The number: `chapter-NN` |
| `scene` | `scene`, `scenes` | `scenes/` | Chapter and number: `chapter-NN-scene-NN` |
| `question` | `question`, `questions` | `continuity/questions/` | The title, or `--id` |
| `promise` | `promise`, `promises` | `continuity/promises/` | The title, or `--id` |
| `clue` | `clue`, `clues` | `continuity/clues/` | The title, or `--id` |
| `term` | `term`, `terms`, `glossary`, `glossary-term`, `glossary-terms` | `glossary/terms/` | The term, or `--id` |
| `matter` | `matter` | `matter/` | The title, or `--id` |
| `research` | `research`, `research-note`, `research-notes` | `research/` | The title, or `--id` |

Kinds are case-insensitive. Ids are lowercase kebab-case: Cyrillic and Greek letters are transliterated, accents are stripped, apostrophes dropped, and every other run of non-alphanumeric characters becomes a hyphen, so `Sera's Reclamation` becomes `seras-reclamation`, `Пётр Иванов` becomes `petr-ivanov`, and `Ολυμπία` becomes `olympia`. The [Project format reference](project-format.md#transliteration) has the transliteration tables.

Names may be written in any script; ids stay ASCII, so that entity filenames are portable across file systems and archive formats. A name written only in a script with no transliteration table (`李明`, `محمد`, `דוד`) leaves nothing to slug, so [`add`](#add) and [`rename`](#rename) take the id from `--id` instead and keep the name as written. `--id` also overrides a transliteration you would spell differently:

```text
$ story add character "Пётр"
Created character petr: ~/stories/the-salt-road/characters/petr.md

$ story add character "李明"
Cannot derive a kebab-case id from character name "李明": pass --id with a kebab-case id, or use a name containing ASCII letters or digits

$ story add character "李明" --id li-ming
Created character li-ming: ~/stories/the-salt-road/characters/li-ming.md
```

### add

```text
story add <kind> <name> [options] [--path <project>]
```

Creates an entity file with starter frontmatter and body sections, then reindexes. It refuses to overwrite an existing file, and refuses an id that Windows reserves as a file name (`con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9`): `Cannot use character id con: Windows reserves the file name con.md. Choose a longer name, such as "con character"`. Options that belong to another kind are ignored; an option no kind reads, such as `--trim`, is an error (`--trim does not apply to story add`). A missing or unknown kind is also an error:

```text
$ story add
An entity kind is required: expected one of character, location, system, faction, artifact, arc, chapter, scene, question, promise, clue, term, matter, research

$ story add villain "Lord Maren"
Unsupported entity kind: villain: expected one of character, location, system, faction, artifact, arc, chapter, scene, question, promise, clue, term, matter, research
```

`--id` sets the id instead of deriving it from the name, which is how a name in a script with no transliteration table gets a file (see [Entity kinds](#entity-kinds)). The value must already be kebab-case, so `add` never quietly rewrites it, and it is refused for chapters and scenes, whose ids come from their numbers:

```text
$ story add character "Пётр" --id Petr
character id must be a kebab-case id, got "Petr"

$ story add chapter "Low Tide" --id opening
--id does not apply to a chapter: a chapter id comes from its number. Use --number for a chapter, or --chapter and --scene for a scene
```

An `--id` that names an existing entity is refused the same way a derived one is (`characters/petr.md already exists`). So is an id that a kind sharing a reference field already uses, since those references could no longer tell the two apart: characters and factions share `owner` and `controlled-by`, and characters and artifacts share `mentions` (`raven is already a character id, and controlled-by and owner references could not tell the faction from the character. Choose another name, or pass --id`).

The name is every positional after the kind. A trailing `.` (or another project folder) is refused rather than written into the name, because `add` takes the project as `--path` (`"." looks like a project path: story add takes the project as --path .`). `rename` and `names` do the same.

`add` writes the entity file, then its backlinks, then the registries. If it is interrupted after writing the file, run the same command again: when the file is exactly what `add` would write and its registry does not list it yet, the rerun applies the backlinks, reindexes, and prints `Finished an interrupted add of <kind> <id>: <file>`. For a chapter or scene without `--number` or `--scene`, the rerun reuses the number the interrupted run took instead of adding a second copy.

For characters and locations, `add` also writes the backlink on the other side: adding a character with `--location gull-harbour` appends the character to that location's `notable-characters`, and adding a location with `--character` appends the location to each character's `locations`.

An option that names a character, location, faction, artifact, or arc with no file is kept, since it may be a forward reference, but `add` warns, as `story links` will report it: `warning: location gul-harbour (locations) does not exist, so no backlink was written; story links reports it until you add it`. Chapter options are not checked this way: a promise planted in a chapter not written yet is normal, and `add scene --chapter` already refuses an unknown chapter.

Options by kind:

| Kind | Options (frontmatter field) | Defaults |
|---|---|---|
| `character` | `--role` (`role`), `--status` (`status`), `--location` (`locations`), `--arc` (`arc`: one free-text theme label such as `redemption`, not an arc id; give it once) | `supporting`, `alive` |
| `location` | `--type`, `--status`, `--region`, `--population`, `--controlled-by`, `--character` (`notable-characters`) | `other`, `unknown` |
| `system` | `--type`, `--prevalence` | `other`, `uncommon` |
| `faction` | `--type`, `--status`, `--member` (`members`; `--character` also works), `--location` (`locations`) | `other`, `active` |
| `artifact` | `--type`, `--status`, `--owner` (`owner`), `--location` (`location`, a single id; give it once) | `object`, `active` |
| `arc` | `--type`, `--status`, `--character` (`characters`), `--theme`/`--themes` (`themes`), `--acts` (`acts`) | `subplot`, `planned` |
| `chapter` | `--number`, `--pov`, `--location` (`locations`), `--character` (`characters`), `--mention` (`mentions`), `--arc` (`arcs-advanced`), `--status`, `--mode`, `--date`, `--time`, `--hook` | One more than the highest chapter number, `outline`; no `hook` |
| `scene` | `--chapter`, `--scene`, `--pov`, `--location` (`location`, a single id; give it once), `--character` (`characters`), `--mention` (`mentions`), `--arc` (`arcs-advanced`), `--status`, `--date`, `--time`, `--travel-hours`, `--sequel`, `--outcome`, `--dilemma` | Latest chapter, one more than that chapter's highest scene number, `outline`; no `outcome` |
| `question` | `--status`, `--introduced`, `--resolved`, `--character` (`characters`) | `answered` with `--resolved`, otherwise `open`; `--status open` with `--resolved` is an error |
| `promise` | `--status`, `--planted`, `--payoff`, `--arc` (`arcs`), `--character` (`characters`) | `planted` when `--planted` names an existing chapter, otherwise `planned` |
| `clue` | `--status`, `--planted`, `--payoff`, `--significance-delayed`, `--red-herring`, `--character` (`characters`), `--arc` (`arcs`) | `planted` when `--planted` names an existing chapter, otherwise `planned`; `red-herring` written only when set |
| `term` | `--category`, `--alias` (`aliases`) | `term` |
| `research` | `--status`, `--source` (`sources`), `--used-in` (`used-in`), `--accuracy`, `--confidence`, `--method`, `--risk` (`risk`) | `open`; the other four fields written only when given |
| `matter` | `--placement`, `--order`, `--heading` | `front`, one more than the highest order in that placement, `heading: true`; `--heading false` writes `heading: false` for a dedication or epigraph |

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
| chapter `--hook` | `cliffhanger`, `question`, `revelation`, `reversal`, `decision`, `emotional`, `resolution` |
| scene `--outcome` | `yes`, `no`, `yes-but`, `no-and` |
| question `--status` | `open`, `answered`, `resolved`, `dropped`, `abandoned` |
| promise and clue `--status` | `planned`, `planted`, `paid-off`, `dropped`, `abandoned` |
| term `--category` | `person`, `place`, `faction`, `artifact`, `concept`, `term`, `other` |
| research `--status` | `open`, `verified`, `disputed` |
| research `--accuracy` | `must-be-accurate`, `blended`, `invented` |
| research `--confidence` | `high`, `medium`, `low` |
| research `--method` | `fact`, `interview`, `site-visit`, `expert-review`, `reading` |
| research `--risk` | `legal`, `medical`, `weapons`, `safety`, `cultural`, `defamation`, `technical` (repeatable) |
| matter `--placement` | `front`, `back` |

On `add chapter` and `add scene`, `--pov` names the POV character, and `add` also puts that id first in `characters` when it is not already listed.

Options that name other entities or chapters (`--chapter`, `--planted`, `--payoff`, `--introduced`, `--resolved`, `--used-in`, `--location`, `--character`, `--mention`, `--member`, `--owner`, `--arc`, `--controlled-by`, and their plural forms) must be kebab-case ids, and so must `--pov` on `add chapter` and `add scene`. A character's `--arc` is exempt: it is a free-text arc theme. A name is refused before anything is written, since it could never resolve, and the example in the message matches the option (`port-kestrel` for a location, `the-long-road` for an arc, `mara-quill or harbor-council` for an owner):

```text
$ story add promise "The Ledger" --planted "Chapter 1"
--planted "Chapter 1" must be a kebab-case id (such as chapter-01)

$ story add chapter "Two" --pov "Mara Quill"
--pov "Mara Quill" must be a character id (such as mara-quill)

$ story add chapter "Two" --number 0
chapter number must be a positive integer, got 0
```

A chapter id in `--chapter`, `--planted`, `--payoff`, `--introduced`, or `--used-in` may name a chapter not written yet, but not `chapter-00`, and only in the spelling `story add chapter` writes (`chapter-01`, not `chapter-1` or `chapter-001`):

```text
$ story add promise "The Ledger" --payoff chapter-00
--payoff chapter-00: chapter numbers start at 1

$ story add promise "The Ledger" --payoff chapter-1
--payoff chapter-1: did you mean chapter-01?
```

A status that says the chapter is on the page needs it written, as `story links` does: `--resolved` on a question, `--planted` with `--status planted` or `paid-off`, `--payoff` with `--status paid-off`, and `--introduced` on a question whose status is not `open` must name an existing chapter (`--resolved chapter-05 is not written yet: a question's resolved chapter must exist. Add --resolved once the answer is drafted`). Without `--status`, a promise or clue planted in an unwritten chapter is `planned`.

`add scene` needs an existing chapter. With no chapters it fails with `No chapters yet: add one with story add chapter before adding a scene`, and a `--chapter` id with no chapter file fails with `chapter chapter-99 does not exist: add it with story add chapter, or pass --chapter with an existing chapter id`.

`add scene` also adds its `location` to the chapter's `locations` and each of its `characters` to the chapter's `characters`, unless the chapter already lists that character in `mentions`. Only ids that have an entity file are copied; an unknown id stays on the scene, where `story links` reports it.

Location and system `--type`, location `--status`, and system `--prevalence` are free text; an empty `--type` is refused. `--date` must be a real `YYYY-MM-DD` day; `--time` is `HH:MM` or one of `dawn`, `morning`, `midday`, `afternoon`, `evening`, `night`; `--travel-hours` is a number zero or above; `--number` and `--scene` are positive integers; `--order` is a non-negative integer. Fields that hold one id refuse a repeated flag or a comma list: `--location` on `add artifact` and `add scene`, `--chapter` and `--pov` on `add scene`, `--owner`, `--controlled-by`, `--planted`, `--payoff`, `--introduced`, and `--resolved` (`--location takes one id for a scene, got port-kestrel, salt-market`). Repeating `--arc` on `add character` writes a list that `story validate` rejects. Other single-value flags keep the last value given.

`--source` keeps each value whole, because citations contain commas. Repeat the flag for more sources. Other list options split on commas.

Examples, run in The Salt Road:

```text
$ story add location "Gull Harbour" --type port --region "the Shallows"
Created location gull-harbour: ~/stories/the-salt-road/worldbuilding/locations/gull-harbour.md

$ story add character "Ilse Marrow" --role protagonist --location gull-harbour
Created character ilse-marrow: ~/stories/the-salt-road/characters/ilse-marrow.md

$ story add arc "The Long Crossing" --type main --character ilse-marrow --themes loyalty,memory --acts act-1,act-2
Created arc the-long-crossing: ~/stories/the-salt-road/plot/arcs/the-long-crossing.md

$ story add chapter "Low Tide" --pov ilse-marrow --character ilse-marrow --location gull-harbour --arc the-long-crossing --date 1024-03-02 --time dawn --hook question
Created chapter chapter-01: ~/stories/the-salt-road/chapters/chapter-01.md

$ story add scene "The Harbour Bell" --chapter chapter-01 --pov ilse-marrow --location gull-harbour --character ilse-marrow --date 1024-03-02 --time 06:30 --outcome yes-but
Created scene chapter-01-scene-01: ~/stories/the-salt-road/scenes/chapter-01-scene-01.md

$ story add clue "Tar on the chain" --planted chapter-01 --significance-delayed
Created clue tar-on-the-chain: ~/stories/the-salt-road/continuity/clues/tar-on-the-chain.md

$ story add clue "The Drowned Lantern" --planted chapter-01 --red-herring --character ilse-marrow
Created clue the-drowned-lantern: ~/stories/the-salt-road/continuity/clues/the-drowned-lantern.md

$ story add term "Slack water" --category concept --alias slack --alias "the turn"
Created term slack-water: ~/stories/the-salt-road/glossary/terms/slack-water.md

$ story add research "Tidal bore timing" --source "Admiralty Tide Tables, 2024 edition" --used-in chapter-01 --accuracy must-be-accurate --confidence medium --method reading --risk safety
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

The same applies to the newer craft fields:

```text
$ story add scene "Bad" --chapter chapter-01 --outcome maybe
Unsupported scene outcome "maybe": expected one of yes, no, yes-but, no-and

$ story add research "Bad" --risk spoilers
Unsupported risk "spoilers": expected one of legal, medical, weapons, safety, cultural, defamation, technical
```

Fill in the body sections by hand, or ask an agent to, after `add`. For what each field means, see the [Project format reference](project-format.md).

### rename

```text
story rename <kind> <id> <new name> [--id <kebab-id>] [--path <project>]
```

Sets the entity's name or title and, when the new name gives a different id, renames the file and rewrites every reference to the old id. References are the id-valued frontmatter fields (such as `characters`, `pov`, `locations`, `owner`, `planted`, `learned-in`, a location route's `to`, and the entries in `continuity/state.md`) and markdown links that resolve to the entity's file. It looks for them in every markdown file in the project except under `dist/`, `node_modules/`, dot-folders, and folders nested more than 10 levels deep, which are skipped silently. Prose is never changed, so update names in the chapter text yourself. A `pattern`, `file`, or `chapter` in `continuity/exemptions.md` that names the old id as a whole token (`chapters/chapter-02.md has POV ann`, `characters/ann.md`) is updated to the new id, so each dismissal stays with its finding; `move` does the same.

Chapter and scene ids come from their numbers, so renaming one changes only its title; to change the number, use [`move`](#move). `rename` also updates the entity's first heading when it shows the old name, such as `# Ilse Marrow` or `# Chapter 1: Low Tide`.

The positional id names the entity being renamed; `--id` gives the id it moves to, instead of one derived from the new name. It is required when the new name leaves nothing to slug (a script with no transliteration table), must already be kebab-case, and is refused for chapters and scenes:

```text
$ story rename character petr "Пётр Иванов"
Renamed character petr to petr-ivanov: ~/stories/the-salt-road/characters/petr-ivanov.md

$ story rename character li-ming "李明华"
Cannot derive a kebab-case id from character name "李明华": pass --id with a kebab-case id, or use a name containing ASCII letters or digits

$ story rename character li-ming "李明华" --id li-minghua
Renamed character li-ming to li-minghua: ~/stories/the-salt-road/characters/li-minghua.md
```

Every rewrite is planned before anything is written, so a file that fails to parse leaves the project unchanged. An entity file (a file directly in an entity folder), one of the registries the CLI writes (the `_index.md` in `characters/`, `worldbuilding/`, `plot/`, `chapters/`, `scenes/`, `continuity/questions/`, `continuity/promises/`, `continuity/clues/`, `glossary/`, `matter/`, and `research/`), or one of `story.md`, `style-sheet.md`, `progress.md`, `plot/timeline.md`, `continuity/state.md`, and `continuity/exemptions.md` with no YAML frontmatter stops it the same way, with `<file> is missing YAML frontmatter; nothing was changed`. Other markdown, such as `continuity/motifs.md`, `continuity/theme-audit.md`, a README, or an `_index.md` in a folder of your own such as `notes/`, may be plain; when its frontmatter uses YAML the CLI does not parse, only its body links are rewritten, and a note over 5 MiB, or past the first 5,000 such notes, is skipped. Reference-style link definitions (`[bo]: ../characters/bo.md`) are rewritten like inline links. A damaged registry gets a hint, since registries are generated: `characters/_index.md is missing YAML frontmatter (it is a registry: run story reindex to rebuild it); nothing was changed`. Every file `rename` will rewrite or delete, and every folder it writes into, must be writable before it starts: otherwise it refuses with `Cannot write to plot/arcs/the-drowned-witness.md (permission denied); nothing was changed. Fix it and run the command again`. A write that still fails partway (a full disk, say) adds `Some files were already updated: fix the problem and run the same command again to finish` to the error; the rerun finishes the job. `move` and `remove` check and report the same way. `rename` refuses if an entity with the new id already exists, if another kind that shares a reference field uses it (see [add](#add)), or if the new id is one Windows reserves as a file name, as `add` does (`Cannot use character id aux: Windows reserves the file name aux.md. ...`).

```text
$ story rename character ilse-marrow "Ilse Varrow"
Renamed character ilse-marrow to ilse-varrow: ~/stories/the-salt-road/characters/ilse-varrow.md

$ story rename chapter chapter-01 "Slack Water"
Renamed chapter chapter-01 to chapter-01: ~/stories/the-salt-road/chapters/chapter-01.md
```

When references to the new id already exist (a planned character in `mentions`, or a link `remove` left behind), they now name the renamed entity, so `rename` lists those files in a warning: `warning: bo was already referenced before this rename, and those references now point at the renamed character: chapters/chapter-04.md. Check them`.

In a series book (one with `follows` or `precedes`), renaming a character, location, system, faction, artifact, or glossary term whose old id a linked book also defines warns, since [`story series`](series.md) matches shared canon by id: `warning: character ann-lee is also defined in linked book Book Two (../b2); story series matches shared canon by id, so rename it there to anne-lee too, or keep the old id`. Only this book is changed.

References are rewritten before the entity file is moved, so if the command is interrupted, run it again to finish. A rerun that finds the new file already written, exactly as this rename writes it, with no reference still naming the old id, deletes the old file. A rerun after the old file is gone, when the new file carries the new name and nothing still names the old id, reindexes and prints `Finished an interrupted rename of <kind> <old-id> to <new-id>: <file>`. An old id that is still referenced but has no file is reported as missing (`character ghost does not exist`), even when another entity already has the new name.

### move

```text
story move chapter <id> --number <n> [--path <project>]
story move scene <id> [--chapter <chapter-id>] [--scene <n>] [--path <project>]
```

Chapter and scene ids come from their numbers, so reordering the book changes ids. `move` renames the files and rewrites every reference to the old id, so you never renumber by hand. It works only on chapters and scenes; use [`rename`](#rename) to change any other id.

**`move chapter`** gives a chapter a new number. It renames `chapters/<id>.md` to `chapter-NN.md` and each of its scene files from `<id>-scene-MM.md` to `chapter-NN-scene-MM.md`, and sets the chapter's `number` and the number in its `# Chapter N:` (or bare `# Chapter N`) heading. It then rewrites every reference to the old chapter id:

- `chapter` on each of the chapter's scenes
- `planted` and `payoff` on promises and clues, and `introduced` and `resolved` on questions
- `used-in` on research notes and `died-in` and `revived-in` on characters
- `from` in the `progressions` of characters, locations, and factions, re-sorting each list into story order when the move takes a chapter past another entry's
- the `to` of every chapter `choices` entry that leads to it, the moved chapter's own included
- `since` and `learned-in` in `continuity/state.md`, and `current-chapter` when it held the moved chapter's number
- markdown links to the moved chapter and scene files, anywhere in the project
- bare chapter and scene ids in the bodies of `plot/timeline.md` and `plot/arcs/*.md`, the ones `story links` checks, and in `plot/_index.md` (the Theme Tracking table). An id is a whole token: `chapter-01-draft` and `pre-chapter-01` are left alone, by `move` and `links` alike
- the chapter and scene ids and file paths in `continuity/exemptions.md` `pattern`, `file`, and `chapter` keys, so a dismissed finding stays dismissed after renumbering and never dismisses the finding for whichever chapter takes the old number

`--number` is required, and the new number must be free. `move` never shifts other chapters to make room, so to insert a chapter, renumber the later chapters from the highest down, then `add` the new one. On a separate copy of The Salt Road with three chapters, a scene in chapter 2, and a clue planted in chapter 2 and paid off in chapter 3:

```text
$ story move chapter chapter-02 --number 3
chapter-03 already exists: move it first. To make room, renumber from the highest chapter down

$ story move chapter chapter-03 --number 4
Moved chapter chapter-03 to chapter-04: ~/stories/the-salt-road/chapters/chapter-04.md

$ story move chapter chapter-02 --number 3
Moved chapter chapter-02 to chapter-03: ~/stories/the-salt-road/chapters/chapter-03.md (with 1 scene)

$ story add chapter "Dead Calm" --number 2 --pov ilse-marrow
Created chapter chapter-02: ~/stories/the-salt-road/chapters/chapter-02.md
```

[`compare`](#compare) against a draft from before the move pairs moved chapters by content and lists them as `(moved from chapter-02)`, so the old chapter 2 is not reported as rewritten or the new chapter 2 as a rewrite of it.

References to a chapter number that has no file yet (a scheduled `payoff: chapter-05`, say) now name the moved chapter, so `move` lists those files in a warning (`warning: chapter-05 was already referenced before this move, ...`).

The clue now reads `planted: chapter-03` and `payoff: chapter-04`, the old chapter 2 is `chapters/chapter-03.md` with the heading `# Chapter 3: The Crossing`, and its scene is `scenes/chapter-03-scene-01.md` with `chapter: chapter-03`.

**`move scene`** moves a scene to another chapter, another position, or both. `--chapter` names the destination chapter, which must exist; without `--scene` the scene takes that chapter's next free number, or keeps its number when `--chapter` is its own chapter. `--scene` alone renumbers the scene within its own chapter. Give at least one of them. `move scene` sets the scene's `chapter` and `scene` fields, rewrites markdown links to the scene file and bare scene ids in the timeline and arc bodies, and adds the scene's `location` and `characters` to the destination chapter's `locations` and `characters` when those entities exist. The chapter it left keeps its lists; trim them by hand if the scene was the only reason for an entry. Continuing the example:

```text
$ story move scene chapter-03-scene-01 --chapter chapter-02
Moved scene chapter-03-scene-01 to chapter-02-scene-01: ~/stories/the-salt-road/scenes/chapter-02-scene-01.md

$ story move scene chapter-02-scene-01 --scene 2
Moved scene chapter-02-scene-01 to chapter-02-scene-02: ~/stories/the-salt-road/scenes/chapter-02-scene-02.md
```

`move` changes ids, numbers, and links, never prose. A "Chapter 2" or "as we saw earlier" in chapter text, and the numbered beats in a chapter's `## Outline`, stay as they were, so reread them after a move.

`move` refuses, and changes nothing, when:

| Situation | Message |
|---|---|
| The kind is not `chapter` or `scene` | `story move works on chapters and scenes, not locations; use story rename to change other ids` (an unknown kind: `Unsupported entity kind: villain: expected one of chapter, scene`) |
| No id | `move requires a chapter or scene id` |
| The chapter or scene does not exist | `chapter chapter-09 does not exist`, `scene chapter-09-scene-01 does not exist` |
| `move chapter` without `--number` | `move chapter requires --number <n>` |
| `move scene` without `--chapter` or `--scene` | `move scene requires --chapter <id>, --scene <n>, or both` |
| The chapter already has that number | `chapter-02 is already chapter 2` |
| The scene is already there | `chapter-02-scene-02 is already scene 2 of chapter-02` |
| The new chapter number is taken | `chapter-03 already exists: move it first. To make room, renumber from the highest chapter down` |
| The new scene id is taken | `chapter-02-scene-01 already exists: move it first` |
| A scene file of the moved chapter would overwrite another file | `scenes/chapter-04-scene-01.md already exists; nothing was changed` |

As with `rename`, every file is parsed before anything is written, so a file that fails to parse leaves the project unchanged (`Cannot move: fix this file first ...`). References are written first and the moved files last (a chapter's scenes before the chapter, and a moved scene's cast added to its new chapter before the old scene is deleted), so if a move is interrupted, run the same command again to finish it. A file already at the new path is accepted only when it is exactly what this move writes and nothing but the moving files still names the old id; otherwise the number counts as taken, so a move onto a placeholder chapter or scene with the same title is refused. Without `--scene`, a rerun of an interrupted `move scene` reuses the number the first run took.

### remove

```text
story remove <kind> <id> [--path <project>]
```

Deletes the entity file and scrubs its id from every reference field, searching the same markdown files as `rename`. List entries are removed, single-value fields are cleared, and whole entries in `relationships`, `character-state`, `knowledge-state`, `object-state`, location `routes`, and chapter `choices` are dropped when they are about the removed entity. Removing a chapter that `choices` lead to also warns, naming the chapters that lost a choice, since one left with none becomes an ending, or, when those were the last choices in the book, that the book is linear again. A `progressions` entry whose `value` was the removed id keeps its chapter and field, with the value cleared. Prose and markdown links in file bodies are never changed, so `remove` lists the files that still link to the removed file (a registry's own sections included) or, for a chapter or scene, still name its id in `plot/timeline.md`, `plot/_index.md`, or an arc, and any `continuity/exemptions.md` entries whose `pattern` or `file` names the id, which no longer match anything (`warning: characters/_index.md, plot/arcs/main.md still mention character bo in links in the text, which remove does not change: edit them, then run story links`). Names in prose are not listed; find them by hand, for example with `grep -rn brass-sounding-line .`. As with `rename`, every file is parsed before anything is deleted, so a file that fails to parse, or an entity file, registry, or fixed project file with no frontmatter, leaves the project unchanged. References are scrubbed before the entity file is deleted, so an interrupted `remove` can simply be run again.

`remove chapter` refuses while scenes still point at the chapter, so remove those first:

```text
$ story remove chapter chapter-01
chapter chapter-01 still has scenes: chapter-01-scene-01. Remove them first with story remove scene <id>
```

It also refuses while a character's `died-in`, a `since` or `learned-in` in `continuity/state.md`, or a progression's `from` names the chapter, because an empty value there means "before the story" and a progression needs the chapter it starts in: `chapter chapter-05 is still named by died-in, since, learned-in, or a progression's from in characters/bob.md; an empty value there means before the story, and a progression needs the chapter it starts in, so point them at another chapter first`.

Removing a chapter also walks back statuses that depended on it. A `planted` promise or clue whose `planted` chapter is cleared becomes `planned`; a `paid-off` one whose `payoff` is cleared becomes `planted`, or `planned` when its `planted` chapter is gone too; an `answered` or `resolved` question whose `resolved` chapter is cleared becomes `open`.

```text
$ story remove artifact brass-sounding-line
Removed artifact brass-sounding-line: ~/stories/the-salt-road/worldbuilding/artifacts/brass-sounding-line.md

$ story remove artifact brass-sounding-line
artifact brass-sounding-line does not exist
```

When the entity file is already gone (deleted in a file manager, or lost in a merge) but references to it remain, `remove` still scrubs them, so a later entity given that id does not silently adopt them: `Removed references to character edran-vale: its file was already gone`. Only an id with no file and no references is reported as missing.

Run `story links` and `story validate` after `rename`, `move`, or `remove` to confirm nothing else needs attention.

## Output commands

These commands produce files for reading or submission. The source of truth stays in the chapter files; regenerate outputs whenever you need them. See [Import, export, and builds](manuscripts.md) for formats, front and back matter, and covers.

### export

```text
story export [path] [--out <file>]
```

Writes one markdown manuscript: the story title, front matter pages, every chapter as `# Chapter N: Title` (the title alone for a `numbered: false` chapter; in the book's `language`, or as `story.md` `labels` sets it, such as `# Kapitel N: Title`) followed by its prose, then back matter pages. Only chapter prose is included, not outlines or notes. Matter pages with no text are left out. The file uses LF line endings, even from a CRLF checkout.

| Option | Effect | Default |
|---|---|---|
| `--out <file>` | Output path, relative to the project root | `dist/manuscript.md` |

```text
$ story export
Exported 1 chapters to ~/stories/the-last-ember/dist/manuscript.md

$ story export --out drafts/manuscript.md
Exported 1 chapters to ~/stories/the-last-ember/drafts/manuscript.md
```

A manuscript written to the project root with `--out manuscript.md` is not part of the project model, so `validate` warns about it:

```text
warning: manuscript.md is not part of the story project model and is ignored [stray-file]
```

`export` fails with `No chapters found to export` on a project without chapters, and, like `build`, refuses two chapters with the same number or a matter file whose name is not kebab-case.

`export` refuses to run while an entity file, registry, or `story.md` fails to parse (see [Files that fail to parse](#files-that-fail-to-parse)). It does not run the other checks, so run `story validate` before you export a copy to send anyone.

### build

```text
story build [path] [--format <name>] [--shunn] [--trim <size>] [--stamp <label>] [--note-url <url>] [--out <file>]
```

Builds a disposable book file in `dist/`. Builds are deterministic: the same sources give byte-identical output. EPUB timestamps use `SOURCE_DATE_EPOCH` when it is set to whole seconds with a year no later than 9999, and a fixed date otherwise. Default file names cap the story id at 100 characters.

| Option | Effect | Default |
|---|---|---|
| `--format <name>` | `markdown` (or `md`), `epub`, `docx`, `shunn`, `html`, `print`, `narration`, `metadata`, `fountain`, `twee`, or `ink` | `markdown` |
| `--shunn` | With `--format docx`, apply Shunn manuscript formatting. An error with any other format | Off |
| `--trim <size>` | With `--format print`, the trim size: `5x8`, `5.25x8`, `5.5x8.5`, `6x9`, or `a5` (case-insensitive). An error with any other format | `5.5x8.5` |
| `--stamp <label>` | With `--format html`, print this build label (a date, commit, or review round, such as `feedback-round-2`) at the top of the review copy, so readers can say which build a note refers to. An error with any other format or an empty label. Default builds carry no stamp and stay byte-identical | None |
| `--note-url <url>` | With `--format html`, add a faint **Note** link beside every paragraph label, to this http or https address with `title=[<label>] `, `anchor=<label>`, `build=<stamp>` (with `--stamp`), and `quote=<first six words>` appended as URL-encoded query parameters. Pointed at `https://github.com/<owner>/<repo>/issues/new?template=manuscript-note.yml`, it opens the [manuscript-note form](../templates/github/ISSUE_TEMPLATE/manuscript-note.yml) already filled in. An error with any other format or another kind of address. Builds without it are unchanged | None |
| `--out <file>` | Output path, relative to the project root | `dist/<story-id>.<ext>` |

| Format | Default output | Contents |
|---|---|---|
| `markdown` | `dist/<story-id>.md` | The same manuscript as `export`, with LF line endings |
| `epub` | `dist/<story-id>.epub` | EPUB 3 with a navigation document, front and back matter, and accessibility metadata. Reads `author` or `authors`, `language`, `isbn`, `publisher`, `publication-date`, `description`, `subjects`, `copyright`, `cover`, and `cover-alt` from `story.md` when set |
| `docx` | `dist/<story-id>.docx` | Word document with headings and paragraphs |
| `docx` with `--shunn` | `dist/<story-id>.docx` | Shunn format: Courier New 12pt, double-spaced, title page |
| `shunn` | `dist/<story-id>.shunn.md` | Shunn manuscript markdown: title, byline, approximate word count (characters for a book counted in characters), `contact` lines, page breaks between chapters; no matter pages |
| `html` | `dist/<story-id>.html` | A single-file review copy for readers: contents list, and a label on every paragraph (`ch03-p12` is chapter 3, paragraph 12) that readers quote with their notes. A label is the paragraph's chapter and position in this build, so an earlier edit in the chapter renumbers it and `move` changes its chapter part; readers should quote the `--stamp` build label and the paragraph's first few words too |
| `print` | `dist/<story-id>.print.html` | A print interior as HTML with CSS paged media, sized to `--trim`, with a title page, contents, and page numbers. Render it to PDF with a paged-media engine such as Paged.js, WeasyPrint, or Prince |
| `narration` | `dist/<story-id>.narration.md` | An audiobook script: estimated runtime at the language's narration pace (155 words a minute in English; 300 characters a minute for a book [counted in characters](project-format.md#counting-in-characters)), a pronunciation guide from `pronunciation` fields in the bible, opening and closing credits, and each section with its estimated minutes |
| `metadata` | `dist/<story-id>.metadata.md` | A retailer metadata sheet from `story.md`: title, authors, ISBN, language, word count (character count for a book counted in characters, with pages estimated from characters a page), estimated print pages, description, keywords, BISAC subjects, and a readiness checklist of what is missing |
| `fountain` | `dist/<story-id>.fountain` | A screenplay scene skeleton in Fountain, not a conversion of the prose: a title page, a `##` section per chapter, and one scene heading per scene record (`INT. LAMP ROOM - DUSK`, from the `setting`, location name, and time), with the scene title as a synopsis and the source scene id, cast, and scene notes as unprinted notes. A scene with no `setting` on it or its location gets a forced heading (`.LAMP ROOM - DUSK`) and a warning. See [Screenplay skeleton](manuscripts.md#screenplay-skeleton-fountain) |
| `twee` | `dist/<story-id>.twee` | A Twine story in Twee 3: `StoryTitle`, `StoryData` with the IFID (`ifid` in `story.md`, or one derived from the story id, with a warning giving the line to pin it) and the first chapter as the start, then one passage per chapter, named by its id, ending in a `[[text->chapter-NN]]` link for each of its [`choices`](project-format.md#branching-chapters). With no choices anywhere, each chapter links to the next. No matter pages. Refuses to build, exiting 3, while a choice is malformed or leads to a missing chapter, a chapter file name is not kebab-case, or `ifid` is malformed, and warns about chapters no choice path reaches. See [Twine story](manuscripts.md#twine-story) |
| `ink` | `dist/<story-id>.ink` | An ink story for Inky and inklecate from the same chapters and choices, with the same checks as `twee`: `# title`, `# author`, and `# ifid` global tags, a divert to the first chapter, then one knot per chapter (`chapter-03` becomes `chapter_03`), ending in a sticky `+ [text] -> knot` choice for each of its `choices`, or `-> END` when it has none. With no choices anywhere, each chapter diverts to the next. Prose and choice text are escaped so ink reads them as text. See [ink story](manuscripts.md#ink-story) |

`export` and `build` print `warning: chapters/chapter-02.md has no prose yet and is built as a heading-only page` for each chapter with no prose, such as one still at `status: outline`, and build anyway.

With `form: short-story` or `form: flash` in `story.md`, both Shunn builds use the short-story layout: no chapter headings or page breaks, and a centred `#` between chapters and at every scene break.

When `story.md` sets `copyright` and no matter page already covers it, `export` and the `markdown`, `epub`, `docx`, `html`, and `print` builds add a generated copyright page to the front matter. `narration` leaves it out, and Shunn output (`--format shunn` and `docx --shunn`) has no front or back matter at all.

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

$ story build --format html
Built 1 chapters as html to ~/stories/the-last-ember/dist/the-last-ember.html

$ story build --format print --trim 6x9
Built 1 chapters as print to ~/stories/the-last-ember/dist/the-last-ember.print.html

$ story build --format narration
Built 1 chapters as narration to ~/stories/the-last-ember/dist/the-last-ember.narration.md

$ story build --format metadata
Built 1 chapters as metadata to ~/stories/the-last-ember/dist/the-last-ember.metadata.md

$ story build --format twee
Built 1 chapters as twee to ~/stories/the-last-ember/dist/the-last-ember.twee
warning: story.md has no ifid, so the build derived 1E3BB0E5-139A-4964-98B4-217D50BEB2A4 from the story id; add ifid: 1E3BB0E5-139A-4964-98B4-217D50BEB2A4 to story.md to keep it if the title changes [derived-ifid]

$ story build --format print --trim 7x10
Unsupported trim size: 7x10. Supported sizes: 5x8, 5.25x8, 5.5x8.5, 6x9, a5

$ story build --format pdf
Unsupported build format: pdf. Supported formats: markdown, epub, docx, shunn, html, print, narration, metadata, fountain, twee, ink
```

An empty value (`--format=`) reads `Unsupported build format: (empty). ...`.

The start of the metadata sheet for [`examples/harbor-of-second-light`](../examples/harbor-of-second-light/), whose `story.md` sets `author`, `language`, `description`, `keywords`, and `subjects`:

```markdown
# Harbor of Second Light: Retailer Metadata

Generated from story.md. Retailer limits change; check each retailer's current requirements before upload.

| Field | Value |
| --- | --- |
| Title | Harbor of Second Light |
| Series | (missing) |
| Author(s) | Morgan Hale |
| ISBN | (missing) |
| Publisher | (missing) |
| Publication date | (missing) |
| Language | en |
| Genre | science-fiction / coastal-mystery |
| Form | novel |
| Word count | 1489 |
| Estimated print pages | 10 at 5.5x8.5, 10 at 6x9 |
| Description | 170 characters (limit 4000) |
| Keywords | 4 of 7: floating city; memory archive; salvage diver; near-future mystery |
| BISAC subjects | FIC028000; FIC022000 |
```

The sheet goes on with the description and a readiness checklist. See [Import, export, and builds](manuscripts.md) for each format in depth, and the [publishing skill](../skills/publishing/SKILL.md) for the `story.md` publishing fields.

`build` refuses a project with no chapters, two chapters with the same number, or a matter file whose name is not kebab-case. A `cover` that is missing, outside the project, or not a `.gif`, `.jpeg`, `.jpg`, `.png`, or `.webp` image fails the EPUB build and `validate`. Keep `dist/` out of version control.

Like `export`, `build` refuses to run while a project file fails to parse, and refuses a chapter whose `number` is not a positive integer (`chapters/chapter-03.md: chapter number must be a positive integer to build`). It does not run the other checks, so run `story validate` before you build a copy to send anyone.

### synopsis

```text
story synopsis [path] [--pages 1|3] [--out <file>]
```

Builds a mechanical synopsis from the project: a `Logline:` line (the first sentence of the `## Synopsis` section in `story.md`, or `No logline recorded.`), then for each arc up to two sentences from `## Setup`, up to two from `## Rising Action`, and a line starting `Because` that joins the first sentence of `## Climax` and of `## Resolution`, lowercasing the climax's first word when it is a whole common opener such as `She` or `The` but not a name (`A.J.` and `He-Man` keep their capitals). Titles such as `Dr.`, `e.g.`, initials, and dotted initialisms such as `U.S.` never end a sentence; `No.`, `vs.`, `etc.`, `a.m.`, and `p.m.` end one unless the next word starts in lower case or with a digit. `--pages 3` takes up to four Setup sentences, eight Rising Action sentences, and two each from Climax and Resolution. If the text exceeds the page budget, it drops rising action, then resolution, then truncates with an ellipsis.

| Option | Effect | Default |
|---|---|---|
| `--pages <n>` | `1` (500-word budget) or `3` (1,500-word budget) | `1` |
| `--out <file>` | Write to this path, relative to the project root, instead of stdout | Print to stdout |

```shell
story synopsis
```

```text
# Synopsis: The Last Ember

Logline: In a world where magic flows from living embers — fragments of a dying god's heart — Sera Voss returns to the Ashen Citadel to reclaim her birthright from Lord Maren, the usurper who murdered her parents and seized control of the Northern Reach.

## Sera's Reclamation

Sera and Kael have survived twelve years in the Whispering Vale. The embers are fading — even in the Vale, the wild motes grow dimmer each season.

Sera gathers information, allies, and ember power. She discovers the ember well beneath the citadel isn't just sealed — it's being drained.

Because Sera infiltrates the citadel through the Whisper Gate. Sera chooses to unseal the ember well and release its power back into the land rather than claim it.
```

```text
$ story synopsis --pages 3 --out dist/synopsis.md
Wrote synopsis to ~/stories/the-last-ember/dist/synopsis.md

$ story synopsis --pages 2
Unsupported synopsis length: 2. Supported pages: 1, 3
```

The output is a scaffold. The [submission skill](../skills/submission/SKILL.md) turns it into a synopsis ready to send to agents.

## Finding codes

Every error and warning has a stable kebab-case code. Text output ends each warning line with it, `warning: chapters/chapter-01.md has 1 [TODO marker in its prose, ... [todo-markers]`, and `--json` gives it as each diagnostic's `code`. A [`severity`](#defaults-and-severity-from-storymd) entry in `story.md` names a warning by its code. Codes never change once released: a reworded message keeps its code, and a code is never reused for another rule.

An error means the project is broken or a check failed, so it cannot be turned down: `severity` accepts only warning codes. A [continuity exemption](continuity.md#exemptions) can name a code too, with a `file`, `chapter`, or `pattern` to narrow it to one finding; it can dismiss any warning code `severity` accepts and the errors `continuity` reports. A code can appear under more than one command, such as `unreachable-chapter`, which `links` reports and a Twee `build` repeats; an override applies wherever it is reported. `report`, `next`, and `doctor` run `validate`, `links`, and `continuity`, so they report those commands' codes.

**Codes by command**

- [Any command](#codes-any-command) · [validate](#codes-validate) · [links](#codes-links) · [continuity](#codes-continuity) · [series](#codes-series)
- [prose](#codes-prose) · [pacing](#codes-pacing) · [clues](#codes-clues) · [voices](#codes-voices) · [names](#codes-names)
- [context](#codes-context) · [compare](#codes-compare) · [similarity](#codes-similarity) · [build and export](#codes-build-and-export) · [add, rename, move, and remove](#codes-add-rename-move-and-remove) · [init and import](#codes-init-and-import) · [JSON failures](#codes-json-failures)

### Codes: any command

| Code | Level | Reported when |
|---|---|---|
| `unreadable-file` | error | A project file cannot be read or its frontmatter does not parse (and, under `series`, a linked book's file, named with the book's folder). Commands that need the file stop instead; `context` reports it as `context-file-skipped`. |

### Codes: validate

| Code | Level | Reported when |
|---|---|---|
| `missing-required-path` | error | A registry or folder every project has is missing. `story migrate` adds it. |
| `windows-reserved-name` | warning | An entity file name (such as `con.md`) is reserved on Windows. |
| `stray-file` | warning | A markdown file at the project root is not part of the project model. |
| `nested-file` | warning | A markdown file sits in a subfolder of an entity folder, which the scan ignores. |
| `symlinked-file` | warning | An entity file is a symlink, which the scan ignores. |
| `interrupted-write` | warning | A temporary file from an interrupted write is left in the project. |
| `stale-registry` | warning | A registry (`_index.md`) does not list a file. Run `story reindex`. |
| `stale-word-count` | warning | A chapter's `word-count` is missing or differs from its prose. Run `story wordcount --write`. |
| `todo-markers` | warning | Chapter prose has `[TODO` markers, which every build prints. |
| `unclosed-comment` | warning | Chapter prose opens an HTML comment that never closes. |
| `no-scene-records` | warning | A chapter has no scene records. |
| `empty-chapter` | warning | A chapter has no prose yet, and the book is complete or the chapter claims to be written. |
| `missing-field` | error | A required field, or a required key of a list entry, is missing or empty. |
| `field-not-scalar` | error | A field that takes one value holds a list or mapping. |
| `field-not-list` | error | A field that takes a list holds something else. |
| `field-invalid-items` | error | A list holds items of the wrong shape, such as an empty string or a non-mapping. |
| `field-not-integer` | error | A field that takes a whole number holds something else. |
| `field-not-number` | error | A field that takes a number, such as `travel-hours`, holds something else. |
| `field-not-boolean` | error | A field that takes `true` or `false` holds something else. |
| `field-not-text` | error | A text field holds a number or boolean; quote it. |
| `field-below-minimum` | error | A number is below its minimum, such as chapter `number: 0`. |
| `unsupported-value` | error | A field holds a value outside its allowed set. |
| `id-not-kebab` | error | A file name, id, or id reference is not kebab-case. |
| `near-miss-key` | warning | A key is a near miss for a known one, such as `died_in` for `died-in`. |
| `wrong-type` | error | A registry or project file has the wrong `type`. |
| `story-id-mismatch` | error | A registry's `story` does not match the project's story id. |
| `entry-not-mapping` | error | A list entry that must be a mapping (an exemption, a progression, a state entry) is not. |
| `schema-too-new` | error | `story.md` uses a newer schema than this CLI knows. |
| `schema-version-mismatch` | error | `story.md` `schema-version` is not the current version. Run `story migrate`. |
| `invalid-book-number` | error | `story.md` `book-number` is not a number 0 or more. |
| `invalid-ifid` | error | `story.md` `ifid` is not a version 4 UUID. |
| `invalid-cover` | error | `story.md` `cover` is not an image inside the project. |
| `invalid-date` | error | A date (`deadline`, `publication-date`, a progress session) is not a real `YYYY-MM-DD` day. |
| `invalid-cli-config` | error | `story.md` `cli-defaults` or `severity` is invalid. See [Defaults and severity](#defaults-and-severity-from-storymd). |
| `invalid-filename` | error | A chapter or scene file name does not follow `chapter-NN.md` or `{chapter}-scene-NN.md`. |
| `filename-number-mismatch` | error | A chapter or scene number does not match its file name. |
| `duplicate-chapter-number` | error | Two chapters share a number. |
| `duplicate-scene-number` | error | Two scenes share a chapter and scene number. |
| `unnumbered-without-title` | error | A chapter with `numbered: false` has no title to print. |
| `invalid-choice` | error | A chapter `choices` entry has no text, bad text, or no target. |
| `invalid-route-hours` | error | A location route's `hours` is not a positive number. |
| `duplicate-route` | warning | A location lists more than one route to the same place. |
| `deceased-without-died-in` | warning | A progression makes a character deceased without a matching `died-in`. |
| `progression-fixed-field` | error | A progression changes a field that cannot change by chapter, such as `died-in`. |
| `progression-list-field` | error | A progression changes a list field. |
| `progression-duplicate` | error | Two progressions change the same field from the same chapter. |
| `progression-out-of-order` | error | Progressions are not listed in story order. |
| `duplicate-pass` | error | `revision-passes` lists a pass twice. |
| `exemption-pattern-too-short` | error | A continuity exemption pattern is under 4 characters. |
| `exemption-unknown-code` | error | A continuity exemption's `code` is not a finding code. |
| `exemption-code-not-dismissible` | error | A continuity exemption's `code` names an error that `continuity` does not report, or a warning `init` or `import` reports: neither can be exempted. |
| `exemption-file-not-relative` | error | A continuity exemption's `file` is absolute or has a `..` segment. |
| `exemption-too-broad` | error | A continuity exemption sets only `code`, which would dismiss every finding of that rule, or sets `file` or `chapter` with neither `code` nor `pattern`, which would dismiss every finding about that file or chapter. |
| `exemption-misspelled-key` | error | A continuity exemption has a key that looks like a misspelled one, such as `Code` or `files`. |
| `exemption-chapter-not-carried` | error | A continuity exemption sets `chapter` with a `code` whose findings carry no chapter, so it could never match. |
| `stale-exemption` | warning | A continuity exemption's `file` is not a file in the project, or its `chapter` is not a chapter, so it matches nothing. |
| `style-use-equals-avoid` | error | A style-sheet `preferred` entry uses and avoids the same word. |
| `style-sample-missing` | warning | A style-sheet `samples` entry names no file or folder. |
| `style-sample-own-chapters` | warning | A style-sheet `samples` entry names this project or its chapters, which the samples are compared with. |
| `unknown-word-list` | warning | A style-sheet `replace-words` or `add-words` entry names no word list, so the checks ignore it. |
| `duplicate-session-date` | error | `progress.md` logs the same date twice. |
| `research-no-sources` | warning | A verified research note lists no sources. |
| `research-unsettled` | warning | A settled chapter relies on open or disputed research. |
| `research-unreviewed` | warning | A research note carries risk, has no `reviewed-by`, and a settled chapter relies on it. |
| `empty-matter` | warning | A matter page has no text and is left out of builds. |
| `permission-pending` | warning | A matter page's permission is pending and the story is complete. |
| `permission-no-rights-holder` | warning | A matter page's permission is granted but names no rights holder. |
| `backslash-path` | warning | A `story.md` path (`follows`, `precedes`, `cover`) uses a backslash. |
| `form-length-range` | warning | The target or finished length is outside the usual range for the story's `form`, in the book's count unit. |
| `unused-target` | warning | `story.md` or a chapter sets a target in the unit the book does not count in (`target-words` in a book counted in characters, or the reverse), so nothing measures it. |
| `session-without-characters` | warning | In a book counted in characters, `progress.md` sessions logged with no `characters` (before the book counted them), which `story progress` leaves out of its pace. `story progress` reports it too. |
| `invalid-language` | error | `story.md` `language` is not a BCP 47 tag. |
| `unsupported-chapter-numerals` | error | `story.md` sets `chapter-numerals: native` for a language whose script has no numerals of its own, such as English or Korean. |
| `unsupported-writing-mode` | error | `story.md` sets `writing-mode: vertical` for a language that is not set in vertical columns (or for traditional Mongolian, not supported yet). |
| `invalid-isbn` | error | `story.md` `isbn` is not a valid ISBN. |
| `invalid-subject` | error | A `story.md` `subjects` entry is not a BISAC code. |
| `too-many-keywords` | warning | `story.md` lists more keywords than most retailers accept. |
| `todo-placeholder` | warning | A publishing field is still a `[TODO]` placeholder. |
| `author-and-authors` | warning | `story.md` sets both `author` and `authors`. |
| `unknown-label` | warning | A `story.md` `labels` entry names no build label, so builds ignore it. |
| `blank-label` | warning | A `story.md` `labels` entry is blank (other than `by`), so builds use the language's own text. |

### Codes: links

`links` also reports `id-not-kebab` for an id reference that is not kebab-case.

| Code | Level | Reported when |
|---|---|---|
| `missing-reference` | error | An id reference names a character, chapter, scene, or other entity that does not exist. |
| `missing-backlink` | error | A relationship, location, or notable character has no matching link back. |
| `backlink-type-mismatch` | error | A relationship's backlink has the wrong type. |
| `legacy-backlink-type` | warning | A relationship's backlink uses a pairing from before story-skills 0.10.0. |
| `route-to-self` | error | A location route points at the location itself. |
| `broken-link` | error | A markdown link points at a file that does not exist. |
| `link-backslash` | error | A markdown link uses a backslash. |
| `link-not-kebab` | error | A markdown link's file name is not kebab-case. |
| `link-outside-project` | error | A markdown link resolves outside the project. |
| `unreachable-chapter` | warning | In a branching book, no choice path from the first chapter reaches a chapter. |
| `series-link-backslash` | error | A `follows` or `precedes` link uses a backslash. |
| `series-link-self` | error | A series link points at this book. |
| `series-link-unreadable` | error | A linked book's `story.md` cannot be read. |
| `series-link-not-project` | error | A linked folder has no `story.md`. |
| `series-link-not-sibling` | error | A linked book is not a sibling folder of this one. |
| `series-missing-backlink` | error | A linked book does not link back. |
| `series-link-other-series` | error | A linked book belongs to another series. |

### Codes: continuity

| Code | Level | Reported when |
|---|---|---|
| `revived-without-death` | error | A character has `revived-in` but no `died-in`. |
| `died-in-missing-chapter` | error | `died-in` names a chapter that does not exist. |
| `revived-in-missing-chapter` | error | `revived-in` names a chapter that does not exist. |
| `revival-before-death` | error | A character is revived no later than they die. |
| `death-status-mismatch` | error | A character has a written `died-in` but is not `status: deceased`. |
| `revival-status-mismatch` | error | A revived character is still `status: deceased`. |
| `posthumous-appearance` | error | A chapter or scene lists a character after a written death. A `died-in` chapter still at `outline` is planned, so later casts are allowed. |
| `deceased-in-cast` | warning | A chapter or scene lists a character who died before the story. |
| `progression-deceased-in-cast` | warning | A chapter or scene lists a character, with no `died-in`, after a progression makes them `deceased`. |
| `progression-death-conflict` | warning | A status progression contradicts `died-in` or `revived-in`: another status still holds at the death chapter or is set while the character is dead, or `deceased` still holds at the revival. |
| `pov-not-in-cast` | warning | A POV character is not in the chapter or scene's `characters`. |
| `pov-scene-mismatch` | warning | A chapter's POV tells none of its scenes. |
| `scene-cast-not-in-chapter` | warning | A scene lists a character its chapter does not. |
| `scene-location-not-in-chapter` | warning | A scene is set somewhere its chapter does not list. |
| `cut-character-in-cast` | warning | A chapter or scene lists a character with `status: cut`. |
| `cut-character-in-arc` | warning | An arc lists a character with `status: cut`. |
| `cut-character-relationship` | warning | A relationship joins a cut character to one who is not cut. |
| `chapter-numbering-start` | warning | Chapter numbering does not start at 1. |
| `chapter-numbering-gap` | warning | Chapter numbering skips a number. |
| `promise-payoff-before-plant` | error | A promise pays off before it is planted. |
| `promise-payoff-missing` | error | A paid-off promise has no payoff chapter. |
| `promise-plant-missing` | error | A planted promise has no planted chapter. |
| `promise-stale-planned` | warning | A promise is still `planned` though its planted chapter has prose. |
| `promise-payoff-passed` | warning | A planted promise's payoff chapter has prose and the promise is still `planted`. |
| `promise-unpaid` | warning | A promise was planted three or more chapters ago and has no payoff yet. |
| `question-resolved-before-introduced` | error | A question resolves before it is introduced. |
| `question-resolution-missing` | error | An answered or resolved question has no resolved chapter. |
| `question-open-but-resolved` | error | An open question records a resolved chapter. |
| `question-unanswered` | warning | An open question was introduced twelve or more drafted chapters ago and has no resolution yet. |
| `clue-payoff-before-plant` | error | A clue pays off before it is planted. |
| `clue-payoff-missing` | error | A paid-off clue has no payoff chapter. |
| `clue-plant-missing` | error | A planted clue has no plant chapter. |
| `clue-stale-planned` | warning | A clue is still `planned` though its planted chapter has prose. |
| `clue-payoff-passed` | warning | A planted clue's payoff chapter has prose and the clue is still `planted`. |
| `clue-unpaid` | warning | A clue was planted three or more chapters ago and has no payoff yet. |
| `complete-with-open-promise` | error | The story is complete but a promise is still planned or planted. |
| `complete-with-open-question` | error | The story is complete but a question is still open. |
| `complete-with-open-clue` | error | The story is complete but a clue is still planned or planted. |
| `current-chapter-ahead` | error | `continuity/state.md` `current-chapter` is past the last chapter. |
| `current-chapter-behind` | warning | `current-chapter` is behind the latest drafted chapter. |
| `state-missing-character` | error | A state entry names a character that does not exist. |
| `state-missing-location` | error | A state entry names a location that does not exist. |
| `state-missing-artifact` | error | An `object-state` entry names an artifact that does not exist. |
| `state-missing-owner` | error | An `object-state` owner is neither a character nor a faction. |
| `state-missing-chapter` | error | A `learned-in` or `since` chapter does not exist. |
| `state-missing-knows` | error | A `knowledge-state` entry has no `knows`. |
| `state-fact-not-kebab` | error | A `knowledge-state` `fact` id is not kebab-case. |
| `state-duplicate-fact` | error | A character learns the same `fact` twice. |
| `state-duplicate-character` | warning | `character-state` repeats a character. |
| `state-duplicate-artifact` | warning | `object-state` repeats an artifact for the same `since` chapter. |
| `state-status-conflict` | warning | An artifact's latest `object-state` status differs from its file. |
| `posthumous-learning` | error | A character learns something after a written death. A `died-in` chapter still at `outline` is planned, so later learning is allowed. |
| `deceased-learning` | warning | A character who died before the story learns something. |
| `progression-deceased-learning` | warning | A character, with no `died-in`, learns something after a progression makes them `deceased`. |
| `learner-not-in-cast` | warning | A character learns something in a chapter that does not list them. |
| `knowledge-not-recorded` | warning | A scene records learning that `knowledge-state` does not. |
| `state-tracks-dead-character` | warning | `character-state` tracks a character who is dead at `current-chapter`, by `died-in` or by a status progression. |
| `state-location-drift` | warning | `character-state` puts a character somewhere their last scene does not. |
| `object-not-recorded` | warning | A scene changes an artifact that has no `object-state` entry. |
| `state-object-drift` | warning | An artifact's `object-state` differs from the last scene that changed it. |
| `gone-artifact-used` | error | A scene uses an artifact after it was destroyed or lost. |
| `gone-artifact-mentioned` | error | A chapter or scene mentions an artifact after it was destroyed or lost. |
| `malformed-date` | warning | A chapter or scene `date` is not a real date. |
| `malformed-time` | warning | A chapter or scene `time` is not a time or named part of the day. |
| `negative-travel-hours` | warning | A scene's `travel-hours` is negative. |
| `travel-hours-undated` | warning | A scene has `travel-hours` but no date. |
| `clock-backward` | warning | A chapter or scene is dated before the story's latest moment so far. |
| `travel-too-fast` | error | Less time passes than a scene's `travel-hours` needs. |
| `route-same-time` | error | A character is at two places at the same moment. |
| `route-too-fast` | error | A character moves between places faster than the fastest route allows. |

### Codes: series

`series` also reports `invalid-book-number`, `series-link-unreadable`, `series-link-not-project`, and `series-link-not-sibling`.

| Code | Level | Reported when |
|---|---|---|
| `series-link-outside` | error | A series link points outside the folder that holds the books. |
| `series-too-many-books` | error | Series links reach more books than the limit. |
| `series-conflict` | error | Linked books name different series. |
| `series-id-missing` | warning | Some linked books set no `series` id. |
| `series-title-mismatch` | warning | Linked books set different `series-title` values. |
| `series-cycle` | error | `follows` and `precedes` make a cycle. |
| `duplicate-book-number` | error | Two books share a `book-number`. |
| `canon-name-mismatch` | warning | A shared entity's name differs from an earlier book. |
| `canon-pronunciation-mismatch` | warning | A shared entity's pronunciation differs from an earlier book. |
| `canon-death-status` | error | A character dead at the end of an earlier book (by `died-in`, a status progression, or `status`) is not deceased. |
| `canon-posthumous-appearance` | error | A chapter or scene lists a character who died in an earlier book, before this book revives them. |
| `canon-posthumous-learning` | error | A character who died in an earlier book learns something, before this book revives them. |
| `canon-destroyed-status` | warning | An artifact destroyed in an earlier book has another status. |
| `canon-destroyed-artifact-used` | error | A scene uses an artifact destroyed in an earlier book. |
| `canon-fact-relearned` | error | A character learns a fact they knew in an earlier book. |

### Codes: prose

| Code | Level | Reported when |
|---|---|---|
| `prose-filter-words` | warning | Filter words per 1,000 narration words exceed `--max-filter-words`. |
| `prose-adverbs` | warning | `-ly` adverbs per 1,000 narration words exceed `--max-adverbs`. |
| `prose-bookisms` | warning | Said-bookism dialogue tags exceed `--max-bookisms`. |
| `prose-avoided-spelling` | warning | A chapter uses a spelling `style-sheet.md` avoids. |
| `prose-uniform-sentences` | warning | Sentence lengths barely vary. |
| `prose-similar-names` | warning | Two characters have similar first names. |
| `prose-baseline-sentences` | warning | Average sentence length is more than 30% away from the `samples` baseline. |
| `prose-baseline-paragraphs` | warning | Average paragraph length is more than 50% away from the baseline. |
| `prose-baseline-dialogue` | warning | The share of words in dialogue is more than 20 points away from the baseline. |
| `prose-baseline-filter-words` | warning | Filter words per 1,000 narration words are further from the baseline than half its rate (at least 3). |
| `prose-baseline-adverbs` | warning | `-ly` adverbs per 1,000 narration words are further from the baseline than half its rate (at least 3). |
| `prose-baseline-small` | warning | The `samples` hold fewer than 2,000 narration words, so the fixed limits apply. |

| `style-sample-unreadable` | warning | A `samples` entry cannot be read, and is left out. |

`prose` also reports `style-sample-missing` and `style-sample-own-chapters`, as `validate` does.

### Codes: pacing

| Code | Level | Reported when |
|---|---|---|
| `pacing-no-hook` | warning | A drafted chapter records no `hook`. |
| `pacing-no-sequel` | warning | Four or more scene units run with no sequel. |
| `pacing-easy-wins` | warning | Three or more scenes in a row end in an outright yes. |
| `pacing-resolution-run` | warning | Three or more chapters in a row end on resolution. |
| `pacing-long-chapter` | warning | A chapter runs over twice the median chapter length. |
| `pacing-short-chapter` | warning | A chapter runs under half the median chapter length. |

### Codes: clues

| Code | Level | Reported when |
|---|---|---|
| `clue-unplanted` | warning | A clue is revealed but never planted. |
| `clue-late-plant` | warning | A clue is planted in the same chapter as its reveal, or the one before. |
| `clue-no-characters` | warning | A clue lists no characters who could notice it. |
| `clue-herring-unresolved` | warning | A red herring has no payoff chapter that debunks it. |
| `clue-none-delayed` | warning | Three or more genuine clues and none is `significance-delayed`. |

### Codes: voices

| Code | Level | Reported when |
|---|---|---|
| `voice-avoid` | warning | A character says a phrase from their `voice-avoid` list. |
| `voice-words-unused` | warning | A character never says a phrase from their `voice-words` list. |
| `voice-sound-alike` | warning | Two characters' dialogue fingerprints are close. |

### Codes: names

| Code | Level | Reported when |
|---|---|---|
| `name-clash` | error | A candidate name is already an existing name or alias. |
| `name-look-alike` | warning | A candidate name looks like an existing one. |
| `name-shared-initial` | warning | A candidate shares a first initial with a major character. |

### Codes: context

| Code | Level | Reported when |
|---|---|---|
| `context-file-skipped` | warning | A file the context would draw on fails to parse and is left out. |

### Codes: compare

| Code | Level | Reported when |
|---|---|---|
| `story-missing-at-ref` | warning | `story.md` does not exist at the `--ref` compared against. |

### Codes: similarity

| Code | Level | Reported when |
|---|---|---|
| `similarity-shared-passage` | warning | A run of at least `--min-words` words in a chapter also appears in the `--against` text. |
| `similarity-no-reference-text` | warning | The `--against` file, folder, or git ref holds no words to compare with. |

### Codes: build and export

`build` and `export` also report `empty-chapter`, and a Twee build `unreachable-chapter`.

| Code | Level | Reported when |
|---|---|---|
| `derived-ifid` | warning | A Twee build derives the IFID because `story.md` sets none. |
| `scene-outside-book` | warning | A Fountain build leaves out a scene whose chapter is not in the book. |
| `scene-no-location` | warning | A Fountain scene has no location. |
| `scene-unknown-location` | warning | A Fountain scene names a location with no record. |
| `chapter-no-scenes` | warning | A Fountain build has chapters with no scene records. |
| `scene-no-setting` | warning | A Fountain build has locations with no interior or exterior setting. |

### Codes: add, rename, move, and remove

| Code | Level | Reported when |
|---|---|---|
| `unknown-reference` | warning | `add` records an id that does not exist yet. |
| `adopted-references` | warning | `rename` or `move` gives an entity an id the project already referenced. |
| `linked-book-id` | warning | `rename` changes an id a linked book also defines. |
| `choices-dropped` | warning | `remove` dropped chapter choices that led to the removed chapter. |
| `leftover-references` | warning | `remove` left mentions of the removed entity in prose links or ids. |
| `stale-exemption` | warning | `remove` left continuity exemption entries whose `pattern` or `file` names the removed entity. |

### Codes: init and import

These commands run before there is a `story.md` to read, so `severity` rejects an entry that names these codes.

| Code | Level | Reported when |
|---|---|---|
| `kept-story-options` | warning | `--force` kept an existing `story.md`, so some options were not applied. |
| `unsplit-chapter-lines` | warning | `import` found chapter lines it did not split on. |

### Codes: JSON failures

With `--json`, a command that stops before producing a result reports one error diagnostic coded by why it stopped, matching the [exit code](#output-streams-and-exit-codes).

| Code | Level | Reported when |
|---|---|---|
| `usage-error` | error | The command line was wrong (exit `2`). |
| `unusable-project` | error | The folder is not a usable story project (exit `3`). |
| `write-refused` | error | A write was refused or failed (exit `4`). |
| `command-failed` | error | Any other failure (exit `1`). |

## Option index

Every option the CLI accepts, in the order `story --help` lists them. "Repeatable" options collect every value; for the rest, the last value wins. Passing an option to a command outside its "Used by" list, such as `--trim` to `timeline`, is an error; the one exception is `add`, which ignores an option that belongs to another entity kind.

| Option | Value | Used by | Notes |
|---|---|---|---|
| `--title` | `<name>` | `import` | Required for `import` |
| `--dir` | `<path>` | `init`, `import` | Target directory |
| `--genre` | `<name>` | `init`, `import` | |
| `--sub-genre` | `<name>` | `init`, `import` | |
| `--setting-era` | `<name>` | `init`, `import` | |
| `--theme` | `<name>` | `init`, `import`, `add arc` | Repeatable |
| `--themes` | `<a,b>` | `init`, `import`, `add arc` | Comma-separated; repeatable |
| `--pov` | `<style\|id>` | `init`, `import`, `add chapter`, `add scene` | A POV style for `init` and `import`; a POV character id for `add chapter` and `add scene`, which also adds it to `characters` |
| `--tense` | `<tense>` | `init`, `import` | `past`, `present`, `future`, `mixed` |
| `--form` | `<form>` | `init` | `novel`, `novella`, `novelette`, `short-story`, `flash`, `serial`, `picture-book`, `chapter-book`; sets `target-words` |
| `--synopsis` | `<text>` | `init`, `import` | |
| `--language` | `<tag>` | `import` | A BCP 47 tag such as `fr`; defaults to the language of an existing `story.md`, else English, and is written to a new `story.md` |
| `--series` | `<id>` | `init` | Kebab-case |
| `--book-number` | `<n>` | `init` | Positive integer |
| `--follows` | `<path>` | `init` | Repeatable |
| `--precedes` | `<path>` | `init` | Repeatable |
| `--force` | | `init`, `import` | Boolean |
| `--write` | | `wordcount` | Boolean |
| `--log` | | `progress` | Boolean |
| `--ref` | `<git-ref>` | `compare` | Exclusive with `--against` |
| `--against` | `<path>` | `compare`, `similarity` | For `compare`, exclusive with `--ref`. For `similarity`, required: a file, folder, or git ref |
| `--path` | `<path>` | Every command except `init` and `import` | Project root |
| `--out` | `<file>` | `export`, `build`, `synopsis`, `diagram` | Relative to the project root |
| `--format` | `<name>` | `build` | `markdown`, `md`, `epub`, `docx`, `shunn`, `html`, `print`, `narration`, `metadata`, `fountain`, `twee`, `ink` |
| `--trim` | `<size>` | `build` | Only with `--format print`: `5x8`, `5.25x8`, `5.5x8.5` (default), `6x9`, `a5` |
| `--stamp` | `<label>` | `build` | Only with `--format html`: a build label printed in the review copy |
| `--shunn` | | `build` | Boolean; only with `--format docx` |
| `--at` | `<chapter-id>` | `knowledge` | Required for `knowledge` |
| `--budget` | `<tokens>` | `context` | Positive integer; default `6000` |
| `--scenes` | `<n>` | `context` | `0` or more earlier scenes to summarise; default `5` |
| `--init` | | `passes` | Boolean; adds the missing default passes |
| `--start` | `<pass>` | `passes` | Kebab-case pass name; marks it `in-progress` |
| `--done` | `<pass>` | `passes` | Kebab-case pass name; marks it `done` |
| `--max-filter-words` | `<n>` | `prose` | Number 0 or more; default 10 per 1,000 narration words |
| `--max-adverbs` | `<n>` | `prose` | Number 0 or more; default 12 per 1,000 narration words |
| `--max-bookisms` | `<n>` | `prose` | Whole number 0 or more; default 2 per chapter |
| `--baseline` | | `prose` | Boolean; on by default when `style-sheet.md` lists `samples` |
| `--min-words` | `<n>` | `similarity` | Whole number 5 or more; default `8` |
| `--pages` | `<n>` | `synopsis` | `1` or `3` |
| `--actionable` | | `report` | Boolean |
| `--id` | `<kebab-id>` | `add` (every kind except `chapter` and `scene`), `rename` | The entity id, instead of one derived from the name; required when the name has nothing to slug, such as a name only in Chinese, Arabic, or Hebrew. Refused for `chapter` and `scene`, whose ids come from their numbers |
| `--number` | `<n>` | `add chapter`, `move chapter` | Required for `move chapter` |
| `--chapter` | `<id>` | `add scene`, `move scene` | |
| `--scene` | `<n>` | `add scene`, `move scene` | |
| `--type` | `<name>` | `add location`, `system`, `faction`, `artifact`, `arc` | |
| `--role` | `<name>` | `add character` | |
| `--status` | `<name>` | `add` (most kinds) | |
| `--mode` | `<name>` | `add chapter` | For example `discovered` |
| `--date` | `<date>` | `add chapter`, `add scene`, `progress` | `YYYY-MM-DD` |
| `--time` | `<time>` | `add chapter`, `add scene` | `HH:MM` or a named time of day |
| `--travel-hours` | `<n>` | `add scene` | |
| `--dilemma` | `<text>` | `add scene` | |
| `--sequel` | | `add scene` | Boolean |
| `--outcome` | `<name>` | `add scene` | `yes`, `no`, `yes-but`, `no-and` |
| `--hook` | `<name>` | `add chapter` | `cliffhanger`, `question`, `revelation`, `reversal`, `decision`, `emotional`, `resolution` |
| `--location` | `<id>` | `add character`, `faction`, `artifact`, `chapter`, `scene` | Repeatable; alias `--locations`. For `add artifact` and `add scene` it sets one location id: give it once; `--locations` is ignored there |
| `--character` | `<id>` | `add location`, `faction`, `arc`, `chapter`, `scene`, `question`, `promise`, `clue` | Repeatable; alias `--characters` |
| `--mention` | `<id>` | `add chapter`, `add scene` | Repeatable; alias `--mentions` |
| `--member` | `<id>` | `add faction` | Repeatable; alias `--members` |
| `--owner` | `<id>` | `add artifact` | |
| `--arc` | `<id>` | `add character`, `chapter`, `scene`, `promise`, `clue` | Repeatable; alias `--arcs`. For `add character` it sets the single `arc` theme label: give it once; `--arcs` is ignored there |
| `--introduced` | `<id>` | `add question` | Chapter id |
| `--resolved` | `<id>` | `add question` | Chapter id; defaults `status` to `answered` |
| `--planted` | `<id>` | `add promise`, `add clue` | Chapter id |
| `--payoff` | `<id>` | `add promise`, `add clue` | Chapter id |
| `--significance-delayed` | | `add clue` | Boolean |
| `--red-herring` | | `add clue` | Boolean |
| `--category` | `<name>` | `add term` | |
| `--alias` | `<name>` | `add term` | Repeatable; alias `--aliases` |
| `--region` | `<name>` | `add location` | |
| `--population` | `<name>` | `add location` | |
| `--controlled-by` | `<id>` | `add location` | |
| `--prevalence` | `<name>` | `add system` | |
| `--acts` | `<a,b>` | `add arc` | Repeatable; alias `--act` |
| `--placement` | `<front\|back>` | `add matter` | |
| `--order` | `<n>` | `add matter` | |
| `--heading` | | `add matter` | Boolean, default true; `--heading false` for a dedication or epigraph |
| `--source` | `<text>` | `add research` | Repeatable, kept whole; alias `--sources` |
| `--used-in` | `<chapter-id>` | `add research` | Repeatable |
| `--accuracy` | `<level>` | `add research` | `must-be-accurate`, `blended`, `invented` |
| `--confidence` | `<level>` | `add research` | `high`, `medium`, `low` |
| `--method` | `<name>` | `add research` | `fact`, `interview`, `site-visit`, `expert-review`, `reading` |
| `--risk` | `<name>` | `add research` | Repeatable; `legal`, `medical`, `weapons`, `safety`, `cultural`, `defamation`, `technical` |
| `-h`, `--help` | | Any | Print help |
| `-v`, `--version` | | Any | Print version |

The plural aliases (`--locations`, `--characters`, `--mentions`, `--members`, `--arcs`, `--act`, `--aliases`, `--sources`) are accepted but left out of `--help`.

## The bundled fallback

[`skills/story-maintenance/scripts/story.js`](../skills/story-maintenance/scripts/story.js) is the whole CLI bundled into one file that runs under plain Node 18 or newer, with no install step. It exists for agents that have the skills copied in but not the npm package. The [story-maintenance skill](../skills/story-maintenance/SKILL.md) tells agents to try `story`, then `bun run story --`, then this file.

```shell
node skills/story-maintenance/scripts/story.js --version
```

```text
0.19.0
```

It accepts the same commands and options, and produces the same output, as the package binary. Run it in place; do not copy it into a story project. The `package.json` next to it (`{"type":"module"}`) lets Node load it as an ES module under any parent `package.json`, so keep the two together: copy the whole `story-maintenance` folder.

The file is generated from `src/` with `bun run build:fallback`, and CI fails if it is out of date (`bun run check:fallback`). See the [Development guide](development.md#the-bundled-fallback) if you change the CLI.

## See also

- [Getting started](getting-started.md): install and first project
- [Project format reference](project-format.md): every file and field the CLI reads
- [Continuity and analysis](continuity.md): the rules behind `continuity`, `prose`, `timeline`, `knowledge`, `pacing`, `clues`, `voices`, `names`, `diagram`, and `passes`
- [Import, export, and builds](manuscripts.md): `import`, `export`, `build` (every format), and `synopsis` in depth
- [Writing workflows](writing-workflows.md): where each command fits in drafting and revision
- [Skills](skills.md): the skills that run these commands for you
- [Automation and CI](automation.md): running checks in GitHub Actions
- [Documentation index](README.md): every page, by audience and task

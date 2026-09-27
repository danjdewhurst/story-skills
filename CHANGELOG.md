# Changelog

All notable changes to Story Skills are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Add an entry under `## [Unreleased]` in the same pull request as any change a user would notice, especially changes to the project format (schema), CLI behaviour, and skill instructions. Users of copied skill installs run the bundled fallback CLI, so they need to know when its behaviour changes. `bun run release` refuses to release while `Unreleased` is empty, and moves its entries under the new version. See [CONTRIBUTING.md](CONTRIBUTING.md#changelog).

This file was started after 0.15.0. Entries for 0.15.0 back to 0.12.0 come from the commit history; older releases are summarised more briefly from their [GitHub release notes](https://github.com/danjdewhurst/story-skills/releases), which list every pull request.

## [Unreleased]

### Added

- Every error and warning has a stable code, listed by command under Finding codes in `docs/cli-reference.md`. Text output ends each `warning:` line with its code in brackets, such as `[stale-word-count]`, so the name to put in `story.md` `severity` is on the line. `severity` now takes any warning code (the eleven codes it took before keep their names) and applies wherever that warning is reported: `links`, `continuity`, `names`, `series`, `timeline`, `progress`, `compare`, and `context` as well as the checks that had codes, the checks `report`, `next`, and `doctor` summarise, and the warnings `build`, `export`, `add`, `rename`, `move`, and `remove` print, which exit 1 when one is promoted. An entry naming an error code is rejected: errors cannot be demoted or turned off. ([#278](https://github.com/danjdewhurst/story-skills/issues/278))
- `story build --format ink` writes a branching book as an ink story for Inky and inklecate: the title, author, and IFID as global tags, one knot per chapter (`chapter-03` becomes `chapter_03`), a sticky `+ [text] -> knot` choice for each chapter choice, `-> END` for an ending, and a divert to the next chapter in a linear book. Wrapped paragraph lines are joined, hard breaks kept, and prose and choice text escaped so ink prints them as text. It shares the Twee build's rules and checks, and `test:examples` builds every example as ink twice and checks the builds match. ([#281](https://github.com/danjdewhurst/story-skills/issues/281))

### Changed

- **Breaking:** `--json` results are `apiVersion` `story/v2`. `diagnostics[].code` is now the finding's rule code (such as `missing-reference`) instead of the check that raised it, which moves to a new `check` field; `file` comes from the finding rather than the start of its message; and a command that fails before producing a result is coded `usage-error`, `unusable-project`, `write-refused`, or `command-failed`. A script that read `code` as the check name reads `check` instead. ([#278](https://github.com/danjdewhurst/story-skills/issues/278))

### Fixed

- `story next` counts a chapter with no `word-count`, or one declaring `1 word`, only under its word-count action, not also as a validation warning to review. ([#278](https://github.com/danjdewhurst/story-skills/issues/278))

## [0.16.0] - 2026-09-27

### Added

- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), and this changelog.
- `plot-structure` Snowflake Method reference: the ten steps from a one-sentence summary to a first draft, each mapped to `story.md`, character, arc, and scene files and the `story` commands that scaffold and check them. ([#267](https://github.com/danjdewhurst/story-skills/pull/267))
- `story init` and `story import` write a `.gitignore` listing `dist/`, story's leftover lock and temporary files, and OS and editor files when the project has none, and print a note when a kept `.gitignore` does not ignore `dist/`. ([#271](https://github.com/danjdewhurst/story-skills/pull/271))
- `story prose -` and `story voices -` check a passage piped to stdin against the project's style sheet and characters, and `story import -` splits a manuscript piped to stdin; import also refuses a chapter that would come out over the 5 MiB read limit. ([#270](https://github.com/danjdewhurst/story-skills/pull/270))
- `--json` on `validate`, `links`, `continuity`, `series`, `report`, `next`, `doctor`, `knowledge`, `progress`, `timeline`, `prose`, `pacing`, `clues`, and `voices` prints one versioned result object (`apiVersion`, `command`, `ok`, `data`, `diagnostics`, `writes`) described by `schemas/result.schema.json`. ([#269](https://github.com/danjdewhurst/story-skills/pull/269))
- Optional `cli-defaults` and `severity` fields in `story.md`: default flags per command (a command-line flag always wins) and named warnings promoted to errors or turned off, checked by `story validate`. `story prose` gains `--max-filter-words`, `--max-adverbs`, and `--max-bookisms`. ([#273](https://github.com/danjdewhurst/story-skills/pull/273))
- Optional `progressions` on characters, locations, and factions: changes to a single-value field from a chapter on (`from`, `field`, `value`), resolved in story time so a later change stays out of earlier chapters. `story validate` and `story links` check them, `story move`, `rename`, and `remove` keep them current, and `story knowledge --at` (and its `--json` data) shows the changes that apply by that chapter. ([#274](https://github.com/danjdewhurst/story-skills/pull/274))
- `story build --format fountain` writes a Fountain screenplay scene skeleton from the scene records (title page, a section per chapter, and one `INT./EXT.` scene heading per scene with source and cast notes, no prose), and an optional `setting` field (`interior`, `exterior`, or `both`) on locations and scenes supplies the `INT.` or `EXT.`. ([#272](https://github.com/danjdewhurst/story-skills/pull/272))
- Branching stories: optional `choices` (`text`, `to`) on chapters and `ifid` in `story.md`, checked by `story validate` and `story links` (choices to missing chapters, chapters no choice path reaches) and kept current by `story move` and `remove`, and `story build --format twee` writes them as a Twine story in Twee 3 with a stable IFID. ([#277](https://github.com/danjdewhurst/story-skills/pull/277))
- `story context <chapter-or-scene-id>` packs the drafting context for a chapter or scene (outline and cast, `story.md` essentials and style-sheet rules, the POV character's knowledge, state, and progressions, character cards, locations, open promises, clues, and questions, and recent scene summaries) into an estimated token budget (`--budget`, `--scenes`, `--json`), with nothing from later chapters. `chapter-writing` and the draft-next-chapter workflow use it. ([#275](https://github.com/danjdewhurst/story-skills/pull/275))

### Changed

- **Breaking:** failures now exit with distinct codes instead of always `1`: `1` for findings (a check's `error:` lines, unchanged), `2` for a usage error, `3` for a folder that is not a usable story project, and `4` for a refused or failed write. `--json` runs exit the same way, and `ok` is `true` only on exit `0`. `story validate || exit 1` and the CI templates still fail on any error; scripts that tested for exactly `1` on a bad flag, a missing project, or a refused write need the new code. ([#276](https://github.com/danjdewhurst/story-skills/pull/276))
- `bun run release` refuses to run while `CHANGELOG.md` has no entries under `Unreleased`, and moves those entries into a dated section for the new version in the release commit.
- `bun run check:metadata` fails when `CHANGELOG.md` has no section for the current package version.
- The npm package now includes `CHANGELOG.md`.

### Fixed

- `story build --out` and `story init --dir` pointing at a folder the file system will not create (one under `/proc`) exit `4` naming that folder instead of hanging at 100% CPU. ([#279](https://github.com/danjdewhurst/story-skills/issues/279))

## [0.15.0] - 2026-09-27

### Added

- `verse-craft` skill: write, scan, and revise verse (limericks, sonnets, haiku, villanelles, ballads, song lyrics, rhyming picture-book text, and verse inside a story) with every line's stresses and the rhyme scheme shown. Includes forms, meter-and-scansion, and rhyme references and a `verse-limerick` eval fixture. ([#253](https://github.com/danjdewhurst/story-skills/pull/253))

### Fixed

- `story links` checks markdown links in front and back matter page bodies, so a broken link in an epigraph credit or also-by page no longer passes silently. ([#254](https://github.com/danjdewhurst/story-skills/pull/254))
- Body link checks read link targets with a title (`a.md "Title"`) or in angle brackets (`<a.md>`), in matter pages, the timeline, and arc files.
- A matter file removed after the project scan is reported as an error instead of crashing the command.

## [0.14.0] - 2026-09-27

### Added

- `story compare --anchor <label>` (repeatable, with `--ref` or `--against`) finds where a paragraph cited from an earlier review copy is now, by exact text first and then by the most similar paragraph. ([#252](https://github.com/danjdewhurst/story-skills/pull/252))
- `story build --format html --note-url <url>` adds a "Note" link beside each paragraph label, prefilled for the manuscript-note issue form. The `review-copy.yml` template passes it.

### Changed

- The feedback-triage and editorial-review skills and the docs use `compare --anchor` in place of the manual worktree procedure.

### Fixed

- `compare --anchor` matches repeated identical paragraphs one to one, so two copies never both claim the one that survived.
- `--note-url` puts the prefill query before any `#fragment`.
- `compare --ref` skips tree entries with a backslash or colon, or that resolve outside its temporary folder.

## [0.13.0] - 2026-09-27

### Added

- Continuity models resurrection (`revived-in`), planned deaths (`died-in` on an outline chapter), posthumous narrators, object-state histories and loss windows, and compares dated chapters in story time. `story continuity` cross-checks `continuity/state.md` against scene state changes.
- Builds keep markdown hard breaks and set blockquotes as block quotations in every format, for verse.
- Chapter `numbered: false`, so a Prologue or Epilogue builds under its title alone. `story import` sets it for Prologue-style and `{.unnumbered}` headings.
- `story.md` `chapter-label` and `contents-label` for non-English editions.
- `story build --format html --stamp <label>` prints a build label in the review copy; the `review-copy.yml` template stamps the date and commit.
- Series `series-title`, `book-number` values of 0 and decimals (such as 1.5), and new series checks: pronunciation drift, artifacts destroyed in an earlier book, and dead characters learning facts.
- `story validate` warns about `[TODO` markers left in chapter prose.
- `story continuity` warns when a `status: cut` character is still in a cast, an arc, or a relationship.

### Changed

- Write commands (`add`, `rename`, `remove`, `move`, `reindex`, `migrate`, `wordcount --write`) hold a `.story.lock` project lock. A second command waits up to 10 seconds (`STORY_LOCK_WAIT_MS`), then refuses with nothing changed.
- `rename`, `remove`, and `move` check that every file they write is writable before the first write, and update `continuity/exemptions.md` patterns that name the old id.
- Word counts treat each Han, Hiragana, and Katakana character as one word.
- Shunn builds use the short-story layout for `form: short-story` and `flash`.
- `--out` never replaces an existing file in `feedback/`, `submission/`, `publishing/`, or `adaptations/`.
- Skill instructions corrected after an end-to-end walkthrough, including dating scenes so the clock and route checks run, and recording deliberate findings in `continuity/exemptions.md`.

### Fixed

- `story clues` counts a clue as planted or revealed only when its status says so and the chapter exists.
- `story compare` pairs a chapter moved by `story move` with its old id.
- The continuity clock and route checks read named times the same way, so they warn only about orders that are impossible on every reading. A character at two places at the same exact time is an error even when no route joins them.
- The still-planned and payoff-passed warnings read the named chapter's own status, so an outline chapter never triggers them.
- A retitled story's validation error points at `story reindex`.

## [0.12.0] - 2026-09-27

### Added

- `story add` and `story rename` take `--id`, so entities with names outside ASCII (Cyrillic, CJK, Greek, Arabic, Hebrew, Devanagari) get a usable kebab-case id.

### Changed

- EPUB and DOCX builds deflate archive entries and set the ZIP UTF-8 name flag. The example EPUBs are 39 to 53 percent smaller.
- The committed fallback is built with the Bun version pinned in `package.json`.

### Fixed

- 143 open bug issues across import, continuity and timeline, write safety, `add`/`rename`/`remove`/`move`, series and init, markdown extraction and word counts, builds and exports, analysis commands, validation, and the repository scripts. See [#250](https://github.com/danjdewhurst/story-skills/pull/250) for the full list.
- Three sorts that used the machine's locale now use a pinned one, so their order does not depend on the machine.
- `check:fallback` and `bun run release` report a missing Bun instead of crashing.

## [0.11.0] - 2026-09-25

### Added

- `story move` renumbers chapters and moves scenes. ([#42](https://github.com/danjdewhurst/story-skills/pull/42))

## [0.10.7] - 2026-09-25

### Fixed

- `story import` no longer duplicates bare chapter headings, and `rename` and `remove` can be resumed after a failure. ([#40](https://github.com/danjdewhurst/story-skills/pull/40), [#41](https://github.com/danjdewhurst/story-skills/pull/41))

## [0.10.1] to [0.10.6] - 2026-09-25

Six patch releases fixing regressions and gaps found by testing each previous release: symlink reads and quadratic scans (0.10.2), scale problems (0.10.3), the route check (0.10.4), `rename` for skill notes (0.10.5), and `story voices` (0.10.6). 0.10.1 made the copied fallback CLI run on any Node version and added `templates/` and `examples/` to the npm package. See the [GitHub releases](https://github.com/danjdewhurst/story-skills/releases) for each one.

## [0.10.0] - 2026-09-25

### Changed

- Every command rejects positional arguments and flags it does not read. `build` rejects `--trim` without `--format print` and `--shunn` without `--format docx`.
- `story export` writes to `dist/manuscript.md` by default.
- Commands that read the whole project refuse to run while a project file fails to parse.
- `--out` refuses project source paths such as `chapters/` or `story.md`.
- `story init` accepts a title with no ASCII letters when `--dir` is given.
- A promise or clue can name a chapter that does not exist yet.
- `adversary` and `in-law` relationships are symmetric, and `former-supervisor` / `former-subordinate` is a new inverse pair.

## [0.9.0] to [0.9.2] - 2026-09-25

0.9.0 added craft checks, new skills, and publishing builds, rewrote `docs/` as a complete guide, and sorted `story next` and `story doctor` actions by priority. 0.9.1 and 0.9.2 updated version examples in the docs and taught the release script to bump them.

## [0.8.0] to [0.8.2] - 2026-09-24

Published the package to npm (with trusted publishing from 0.8.2), added the README demo and plugin assets, and fixed the `story` bin declaration.

## [0.7.0] - 2026-09-22

Added the style sheet, prose lint, front and back matter, research, timeline, progress, and compare features, `story --version`, validation of the examples against the JSON schema, and a Node 18/20/22 test matrix. The CLI moved to command and option registries.

## [0.6.0] - 2026-09-20

Fixes from a full review across the CLI, schema, docs, and CI.

## [0.5.0] - 2026-09-20

Added the eval harness for the fiction-writing skills, five new skills, new CLI checks, and genre packs.

## [0.4.0] - 2026-09-16

Added series support: linking sequels and prequels. Fixes from a full-project review.

## [0.3.2] - 2026-09-01

Added the release script. `rename` and `remove` no longer corrupt prose and unrelated fields.

## [0.3.1] - 2026-09-01

First tagged release.

[Unreleased]: https://github.com/danjdewhurst/story-skills/compare/v0.16.0...HEAD
[0.16.0]: https://github.com/danjdewhurst/story-skills/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/danjdewhurst/story-skills/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/danjdewhurst/story-skills/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/danjdewhurst/story-skills/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/danjdewhurst/story-skills/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/danjdewhurst/story-skills/compare/v0.10.7...v0.11.0
[0.10.7]: https://github.com/danjdewhurst/story-skills/compare/v0.10.6...v0.10.7
[0.10.6]: https://github.com/danjdewhurst/story-skills/compare/v0.10.5...v0.10.6
[0.10.1]: https://github.com/danjdewhurst/story-skills/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/danjdewhurst/story-skills/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/danjdewhurst/story-skills/compare/v0.9.1...v0.9.2
[0.9.0]: https://github.com/danjdewhurst/story-skills/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/danjdewhurst/story-skills/compare/v0.8.1...v0.8.2
[0.8.0]: https://github.com/danjdewhurst/story-skills/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/danjdewhurst/story-skills/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/danjdewhurst/story-skills/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/danjdewhurst/story-skills/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/danjdewhurst/story-skills/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/danjdewhurst/story-skills/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/danjdewhurst/story-skills/releases/tag/v0.3.1

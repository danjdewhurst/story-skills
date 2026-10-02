# Changelog

All notable changes to Story Skills are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Add an entry under `## [Unreleased]` in the same pull request as any change a user would notice, especially changes to the project format (schema), CLI behaviour, and skill instructions. Users of copied skill installs run the bundled fallback CLI, so they need to know when its behaviour changes. `bun run release` refuses to release while `Unreleased` is empty, and moves its entries under the new version. See [CONTRIBUTING.md](CONTRIBUTING.md#changelog).

This file was started after 0.15.0. Entries for 0.15.0 back to 0.12.0 come from the commit history; older releases are summarised more briefly from their [GitHub release notes](https://github.com/danjdewhurst/story-skills/releases), which list every pull request.

## [Unreleased]

### Added

- Language packs keyed by `story.md` `language`. `story prose`, `story voices`, and `story names` now take their word lists (filter words, said-bookisms, `-ly` adverbs, speech verbs, contractions, stopwords, British and American spellings, and the titles stripped from a name) from a pack for the book's language, resolved from the BCP 47 tag (`fr-CA`, then `fr`, then a generic base pack). Only English has word lists so far, and English output is unchanged. In a book in another language, a check whose list the pack lacks is skipped instead of run with English words, so a French manuscript no longer gets English false positives: the text output prints a `Note:` line naming each skipped check and the language, and `--json` lists them in `data.skipped` (`[]` for English). In `story voices`, lines are then attributed by action beats alone and `contractions` is `null`; a `story prose` baseline leaves out the skipped rates and signature words (`null` in `--json`), and `--json` adds `data.language`. Packs are found from fixed tables, the same on every runtime: `eng` is English and `iw` Hebrew, an extlang tag such as `zh-yue` uses the `zh` pack, and a grandfathered tag such as `en-GB-oed` uses its modern form. A `language` that is set but not a valid tag (`fr_FR`) picks its pack by its first subtag, never English. `story validate` now also accepts tags with one-character subtags, such as `ja-JP-u-ca-japanese`, and rejects no tag it accepted before. The synopsis splits sentences with the book's pack. `story import --language <tag>` splits the manuscript with that language's heading words and writes `language` to the new `story.md`; without it, an import into an existing project uses that project's language. Exit codes are unchanged. ([#306](https://github.com/danjdewhurst/story-skills/issues/306))
- Builds are typeset for the book's script. The script comes from the `language` tag's script subtag (`sr-Latn`, `zh-Hant`), else the language's usual script (`zh-TW` is Traditional Chinese, `ru` Cyrillic), else Latin, and a Latin-script book builds byte for byte as before. The HTML review copy, print interior, and EPUB name serif font stacks for Japanese, Simplified and Traditional Chinese, Korean, Arabic, Hebrew, Devanagari, Thai, and Cyrillic and Greek (system fonts, then Noto, then `serif`); such an EPUB gains a `style.css`. A script without capitals drops the print interior's small caps, enlarged first letter, and italic running heads. The DOCX builds declare any `language` but `en` to Word (`w:lang`, with its East Asian or bidi language), use MS Mincho, SimSun, PMingLiU, Batang, Mangal, or Tahoma for the East Asian or complex-script slot, and mark a right-to-left book's paragraphs, runs, and section right to left, with bold and italic that reach Arabic and Hebrew text. New `story.md` field `writing-mode: vertical` sets a Japanese, Chinese, or Korean book in columns, top to bottom and right to left: `writing-mode: vertical-rl` in the EPUB, HTML, and print CSS, `page-progression-direction="rtl"` on the EPUB spine and Kindle's `primary-writing-mode` meta, a print interior that opens from the right, and a vertical DOCX section. `story validate` errors with `unsupported-writing-mode` when the language is not Japanese, Chinese, or Korean, and for traditional Mongolian, whose left-to-right columns are not supported yet; builds then ignore it. Scripts are found from the same fixed alias tables as the language packs (`jpn` is Japanese, `zh-yue` Cantonese in Traditional characters), and Word gets the tag in its usual form. ([#312](https://github.com/danjdewhurst/story-skills/issues/312))
- Chinese and Japanese books are counted in characters. A book whose `language` is `zh` or `ja` measures its length in characters (non-whitespace grapheme clusters, punctuation included, after the same markdown handling as word counts), and the new `story.md` field `count-unit: words | characters` overrides the language either way. In such a book `story wordcount` prints characters, and `--write`, `story import`, and `story add chapter` record a new chapter field, `character-count`, beside `word-count`; `story validate` warns when either is stale (`stale-word-count`). The new `target-characters` field, in `story.md` and chapters, is the target that `story progress`, `story report`, and `story context` read. `story validate` checks it against per-form character ranges for the forms a source sets (flash, short story, novella, and novel; a novel has a minimum only): Chinese from the China Writers Association's Lu Xun and Mao Dun prize rules, Japanese from 400字 manuscript-sheet conventions and the Hoshi Shinichi Award's entry cap, documented with their sources and caveats in the [project format reference](docs/project-format.md#counting-in-characters). `story init --form` writes it for a book linked to a Chinese or Japanese one. A target in the unit the book does not count in warns `unused-target`. `story progress --log` records `characters` in each session, and sessions logged without them warn `session-without-characters`. The chapter registry, `story pacing`, the metadata sheet, the Shunn title page, the print page estimate (characters per page for each trim), and the narration runtime (300 characters a minute) all use characters, and `story reindex` replaces the registry's old total heading when the unit changes. The `--json` results of `report`, `pacing`, and `progress` gain `unit` and character counts beside the word counts (`characterCount`, `medianCharacterCount`, `targetCharacters`, null in a book counted in words); word counts keep their meaning, and targets and what is measured against them follow `unit`. Word-based analysis stays in words. Text output for books counted in words, including every English book, is unchanged. ([#310](https://github.com/danjdewhurst/story-skills/issues/310))

### Changed

- Sentences and dialogue follow the book's language. `story voices` finds speech in the language's own quote marks: every language now reads guillemets (`« … »`, `‹ … ›`), low-high quotes (`„…“`, `„…”`, `‚…‘`), and corner brackets (`「…」`, `『…』`) as well as curly and straight quotes, while German and Danish read `»…«` (where `»` opens), Danish also `”…”`, Swiss German `«…»`, and Swedish and Finnish `”…”`, `’…’`, and `»…»` with an en or em dash for dialogue; all of these keep straight and curly quotes. Speech is trimmed inside its marks (`« Viens »` is `Viens`). Dash dialogue resumes after a tag the next dash closes, so in `—Ya voy —dijo ella—. Espera.` both `Ya voy` and `Espera.` are speech, in English too, while a dash in the narration after the tag (`—Go home —he said. The sky darkened—rain was coming.`) is not speech; in Swedish and Finnish a dash after a finished line and before a capital starts a new line (`– Hej, sa Anna. – Kom hit.`), where elsewhere it is narration (`—Is it? —I asked.`). Names in Chinese, Japanese, Thai, and the other unspaced scripts are found inside the surrounding text at word boundaries, so `「行こう」とミナは言った。` is attributed to Mina, and `voice-words` and `voice-avoid` phrases in those scripts match. Questions and exclamations count `？`, `؟`, and `！`. Sentences (in `story prose`, `story voices`, and the synopsis) also end at `؟`, `۔`, `।`, `॥`, and `።`; Spanish `¿` and `¡` open one; a letter of a script without case (Arabic, Hebrew, Devanagari, CJK) starts one as a capital does, so Arabic, Hebrew, and Hindi paragraphs no longer count as one sentence; French guillemets may be set off by spaces (`Il partit. « Quoi ? » demanda-t-il.` is two sentences); after a full-width stop, `“` belongs to the sentence only when it closes an open quote, so `他走了。“等一下，”小明说。` is two sentences; and a synopsis list item ending in `।` or `؟` no longer gets a full stop added. `story prose` leaves the language's quoted speech out of its narration counts. English books read only curly and straight quotes as before, and their output is unchanged except for dash dialogue whose tag a second dash closes, and a synopsis list item ending in `…` or a closing quote, which no longer gets a full stop added. See [Sentences and dialogue in other languages](docs/continuity.md#sentences-and-dialogue-in-other-languages). ([#308](https://github.com/danjdewhurst/story-skills/issues/308))
- `story add`, `story rename`, and `story init` transliterate Cyrillic and Greek names and titles into ids, so `story add character "Пётр"` writes `characters/petr.md` and `Ολυμπία` gives `olympia` without `--id`. Cyrillic follows a simplified BGN/PCGN table shared by Russian, Ukrainian, Belarusian, Bulgarian, Serbian, and Macedonian letters; Greek follows a simplified ELOT 743. Both tables are in the [project format reference](docs/project-format.md#transliteration). Ids stay ASCII. Names in other scripts (Chinese, Arabic, Hebrew, and the rest), and names with a Cyrillic or Greek letter the tables lack (Kazakh `қ`), still need `--id` with the same error as before. Existing ids are never rewritten: the story id is still derived from the title and folder name without transliteration, and review-copy labels for unnumbered chapters are unchanged. `story init` without `--dir` uses the transliterated title for the folder name when the title has no ASCII letters or digits (`voyna-i-mir`). ([#313](https://github.com/danjdewhurst/story-skills/issues/313))
- The writing skills are language-aware. chapter-writing, discovery-drafting, scene-craft, voice-style, verse-craft, revision-continuity, line-editing, and reader-panel read `language` in `story.md` (default `en`) and draft, edit, and critique in that language. Craft advice built on English word lists (filter words, -ly adverbs, *said* and said-bookisms, British and American spelling pairs) is labelled as English, and when `story prose` or `story voices` reports a check skipped for the book's language, the skill does that pass by reading. story-init asks for the language and adds it to `story.md`, with `dialect: unspecified` in the style sheet for a book not in English; premise-workshop includes it in its brief. ([#314](https://github.com/danjdewhurst/story-skills/issues/314))
  - New line-editing reference, `language-conventions.md`: dialogue and punctuation conventions by language (quote marks, dialogue dashes, spacing before punctuation, Spanish `¿` and `¡`, CJK brackets), used by line-editing and voice-style to fill the style sheet.
  - verse-craft scans verse in other languages by their own tradition: syllabic, quantitative, mora-based, or tonal, with rhyme conventions for French, Spanish, Chinese, and Japanese.
  - publishing covers Thema subjects alongside BISAC, ISBN agencies and legal deposit outside the English-speaking markets, retail routes outside the US and UK, fixed book prices, and rights starting from the book's own language. submission marks its query-letter, Shunn, and word-count conventions as the English-language market's, and premise-workshop's form lengths as English word counts.
  - adaptation notes that the 155 words per minute narration rate is English, and that pronunciation respellings follow the narrator's language.
- Thai, Lao, Khmer, and Burmese are counted word by word. They put no spaces between words, so a whole paragraph used to count as one word; each run of these scripts is now split with `Intl.Segmenter`'s dictionary, so `ฉันรักแมว` is three words. The dictionary is the runtime's ICU data, so counts in these scripts can shift slightly between Node and Bun versions. `story compare --anchor` now splits Chinese and Japanese a character at a time, as `wordcount` does, so an edited paragraph in those languages is found rather than reported as not found, and `compare` and `similarity` split the four Southeast Asian scripts the same way. `similarity` now also reads the Katakana long-vowel mark `ー` as a word of its own, as `wordcount` does, so `ーa` is two words there rather than one. The not-found excerpt of `compare --anchor` and the note link's quote in an HTML review copy give the first six words of a paragraph in these scripts rather than the whole paragraph, and skip punctuation-only tokens such as a dash when counting, and `story synopsis` cuts an over-budget paragraph in them at a word rather than dropping it. Counts in every other script are unchanged. ([#307](https://github.com/danjdewhurst/story-skills/issues/307))
- Names, titles, and words shown to the author sort in the book's language: the narration build's pronunciation guide, unnumbered books in `story series` (when every book shares a language, regional variants such as `sv-SE` and `sv-FI` counting as one; English otherwise), the word lists in `story prose` and `story voices`, and `story import`'s entity candidates. Swedish lists `Åsa` after `Zorn`, German files `Äpfel` with `Apfel`, and Turkish puts `çay` after `cuma`. Words are lower-cased in the book's language before they are compared, including `story validate`'s check that a style-sheet `preferred` entry's `use` and `avoid` differ, and `build --format fountain` upper-cases names and places in it, so Turkish `iskele` becomes `İSKELE`. The Shunn manuscript's word count (`--format shunn` and `docx --shunn`) is written as the language writes numbers, `12.300` in German, always with the digits 0 to 9; author-facing CLI reports are unchanged. Ids (including POV ids in `story timeline`), file names, and number tie-breaks sort as before, and names the collator ranks equal are ordered by code point. English output is unchanged. ([#309](https://github.com/danjdewhurst/story-skills/issues/309))

### Fixed

- `story prose` watch words and avoided spellings, and `story voices` `voice-words` and `voice-avoid`, follow Turkish and Azerbaijani casing in a book in those languages, so `ılık` counts `ILIK`, and `ince` counts `İnce` but not `ınce`, and a dotted capital I written as `I` plus a combining dot counts too. Before, they matched by English casing whatever the language. Every other language matches as before. ([#324](https://github.com/danjdewhurst/story-skills/issues/324))
- The Shunn DOCX build wrote bold and italic after the font size in each run's properties, against the order the WordprocessingML schema sets, which strict readers can reject. Runs now list the font, bold, italic, then the size, so bold and italic Shunn runs change byte for byte; how Word shows them does not. ([#312](https://github.com/danjdewhurst/story-skills/issues/312))

## [0.18.0] - 2026-09-29

### Added

- `reader-panel` skill: structured simulated reads of a chapter range by five personas (a target-genre reader, a line editor, a sensitivity persona that only flags passages for a human reader, a continuity-minded reader, and a first-page reader), each written to `feedback/round-{N}/{persona}.md` in the feedback-triage file shape with `source: simulated` and `persona`. Personas read only the chapters in range, with `story context` for background. `feedback-triage` labels a simulated round's synthesis, sorts its findings as single-reader, and treats its `ready` verdict as ready for human readers only. ([#293](https://github.com/danjdewhurst/story-skills/issues/293))
- `story prose` compares chapters with the author's own prose. List files or folders of it as `samples` in `style-sheet.md`, such as an earlier book or approved chapters, read as `story similarity --against` reads them. From them `prose` builds a profile: sentence length and spread, paragraph length, dialogue share, filter-word and adverb rates, and 20 signature words. It then warns when a chapter drifts past fixed, documented tolerances in either direction (`prose-baseline-sentences`, `-paragraphs`, `-dialogue`, `-filter-words`, `-adverbs`). The author's own rates replace the fixed `--max-filter-words` and `--max-adverbs` limits. Samples under 2,000 narration words warn `prose-baseline-small` and keep the fixed limits. `--baseline false` turns the comparison off, `--json` adds `data.baseline` and `chapters[].baseline`, and `story validate` checks `samples` (`style-sample-missing`). The `voice-style` and `line-editing` skills set samples and treat a drift as a prompt to reread. ([#292](https://github.com/danjdewhurst/story-skills/issues/292))
- `story similarity [path] --against <file|folder|git-ref>` finds passages of chapter prose that share a run of words with other text: earlier books, a previous draft, or a source. Words are compared lowercased without punctuation, and each run of `--min-words` (default 8, at least 5, settable in `cli-defaults`) or more shared words is a `similarity-shared-passage` warning. The warning gives the chapter's review-copy label, the reference's location, and the shared words, and the report adds per-chapter and total shares. A folder with `story.md` is compared chapter by chapter; any other folder contributes its `.md`, `.markdown`, and `.txt` files; anything else is tried as a git ref, read as `compare --ref` reads one. It supports `--json` and is advisory: it exits 0 unless `severity` promotes the warning. The `editorial-review` skill runs it and says how to report shared text honestly: overlap is not plagiarism, and no match is not proof of originality. ([#291](https://github.com/danjdewhurst/story-skills/issues/291))
- Standalone `story` binaries for writers without Node, built with `bun build --compile` for macOS (arm64 and x64), Linux (x64 and arm64), and Windows (x64). Each release builds every binary on its own OS and smoke-tests it there (`--version` and `validate` on an example), attaches the archives and a `story-skills_<version>_checksums.txt` to the GitHub release, and, with a `HOMEBREW_TAP_DEPLOY_KEY` secret (an SSH deploy key on the tap), updates the formula in `danjdewhurst/homebrew-tap`, so `brew install danjdewhurst/tap/story-skills` installs the CLI. CI builds and runs each binary on its own OS too. The binaries report the same `story --version` as the npm package, which stays the primary channel. ([#296](https://github.com/danjdewhurst/story-skills/issues/296))
- `story series` and `story diagram` read deaths recorded as status progressions, as `story continuity` does. Deaths and revivals are resolved once, in the new `src/deaths.js`, from `died-in`, `revived-in`, `status`, and status progressions in story order. `story series` reads each earlier book's state at its end, in chronological order: a character killed by a progression in book one is reported in book two with the existing `canon-death-status`, `canon-posthumous-appearance`, and `canon-posthumous-learning` codes, a revival in an earlier book clears the death, and a later book that brings a character back with a status progression is not flagged from that chapter on. `story diagram relationships` marks characters dead at the end of the book (by `died-in`, a progression, or `status`) as `deceased`, and adds a `revived` class for those who died and came back. ([#287](https://github.com/danjdewhurst/story-skills/issues/287))

### Changed

- `story validate` and `schemas/story.schema.json` now accept the same frontmatter, checked by a new seeded property test (`test/validate-schema-property.test.js`). Each disagreement it found was fixed on the side that was too loose, so some projects that passed before now report an error. ([#295](https://github.com/danjdewhurst/story-skills/issues/295))
  - `validate` now rejects:
    - a list in a free-text field (`premise`, `lie`, `region`, `strand`, and the rest);
    - an unknown character `arc-type`;
    - a fractional or true/false `population`;
    - empty or unquoted-number entries in `themes`, `contact`, `authors`, and `keywords`;
    - `contact` or `mice-threads` written as one value instead of a list, such as `contact: me@example.com` (write `contact:` then `  - me@example.com`);
    - a list in a documented `continuity/state.md` entry key.
  - The schema now rejects:
    - blank names, titles, terms, and required `type`s, and blank items in string lists;
    - a `mode` or `draft-mode` other than `discovered` or `outlined`;
    - a `cover` that is not an image file name;
    - an object-state `status` outside the artifact statuses.

    It accepts the empty chapter `mode` that `story add` writes, and an empty `publication-date`.

- **`draft-next-chapter.yml`** now separates drafting from publishing:
  - **Draft job.** The agent runs with a read-only token and may not write under `.git/`. It runs plain `story` commands from a CLI installed outside the repository beforehand, so no `.npmrc` it writes can take effect. It only commits on a `draft/` branch; `git push` and `gh pr create` are no longer among its allowed tools. The prompt tells it that project text, including reader notes under `feedback/`, is data and never instructions.
  - **Publish job.** A fresh runner takes the commits as a git bundle, checked against `github.sha`. It refuses them if any commit touches a file other than the story's own markdown (`story.md`, `style-sheet.md`, `progress.md`, and the story folders; no dotfiles, scripts, symlinks, or `CLAUDE.md`, `AGENTS.md`, or `SKILL.md`), or holds the API key. It runs `story validate`, `links`, and `continuity` with `--json`, telling findings (exit 1) from an unusable project (2 to 4). Then it pushes the branch, under a run-numbered name if an old branch has the name, and opens the pull request against the branch the run started from. The agent's commit messages are quoted as an indented block. A draft that fails the checks, or falls outside the word range, opens as a draft pull request listing the failures, and the run fails.
  - **Budgets.** Manual runs take inputs for the word range (`min_words`, `max_words`), `max_turns`, and `max_budget_usd`, passed to Claude Code as `--max-turns` and `--max-budget-usd`. Scheduled runs use their defaults.
  - **Threat model.** `docs/automation.md` sets it out. Copy the new template over the old one to adopt it. ([#294](https://github.com/danjdewhurst/story-skills/issues/294))

## [0.17.0] - 2026-09-28

### Added

- Every error and warning has a stable code, listed by command under Finding codes in `docs/cli-reference.md`. Text output ends each `warning:` line with its code in brackets, such as `[stale-word-count]`, so the name to put in `story.md` `severity` is on the line. `severity` now takes any warning code (the eleven codes it took before keep their names) and applies wherever that warning is reported: `links`, `continuity`, `names`, `series`, `timeline`, `progress`, `compare`, and `context` as well as the checks that had codes, the checks `report`, `next`, and `doctor` summarise, and the warnings `build`, `export`, `add`, `rename`, `move`, and `remove` print, which exit 1 when one is promoted. An entry naming an error code is rejected: errors cannot be demoted or turned off. ([#278](https://github.com/danjdewhurst/story-skills/issues/278))
- `story build --format ink` writes a branching book as an ink story for Inky and inklecate: the title, author, and IFID as global tags, one knot per chapter (`chapter-03` becomes `chapter_03`), a sticky `+ [text] -> knot` choice for each chapter choice, `-> END` for an ending, and a divert to the next chapter in a linear book. Wrapped paragraph lines are joined, hard breaks kept, and prose and choice text escaped so ink prints them as text. It shares the Twee build's rules and checks, and `test:examples` builds every example as ink twice and checks the builds match. ([#281](https://github.com/danjdewhurst/story-skills/issues/281))
- `story continuity` reads character `status` progressions in story order. A progression to `deceased` with no `died-in` is treated as the death, so a later chapter or scene cast (`progression-deceased-in-cast`) or learning (`progression-deceased-learning`) warns, `character-state` tracking them at `current-chapter` warns (`state-tracks-dead-character`), and a status progression that contradicts `died-in` or `revived-in` warns (`progression-death-conflict`). A progression to `deceased` after `revived-in` is checked as a second death. A character dead before the story is no longer flagged in casts or learning from the chapter a status progression brings them back. ([#280](https://github.com/danjdewhurst/story-skills/issues/280))
- Continuity exemptions match on a finding's `code`, `file`, and `chapter`, as well as `pattern`: an entry dismisses a finding when every key it sets matches, so `code: clock-backward` with `file: scenes/chapter-06-scene-01.md` dismisses that one finding without copying its text. Logs that use only `pattern` work as before. An entry that names a warning's `code` also dismisses it wherever another command reports it, as `severity` does, and applies before `severity`. `story continuity` findings about a chapter, scene, learning event, or dated scene carry a `chapter`, and `--json` diagnostics gain `chapter` and, when dismissed, `exemptionIndex`, the matching entry. `story validate` checks the new keys (`exemption-unknown-code`, `exemption-code-not-dismissible`, `exemption-file-not-relative`, `exemption-too-broad` for an entry with only a `code`, or only a `file` or `chapter`, `exemption-misspelled-key`, `exemption-chapter-not-carried`) and warns (`stale-exemption`) about a `file` or `chapter` that names nothing; `rename` and `move` carry `file` and `chapter`, and `remove` warns about them. The `the-gull-rock-light` example has an exemptions log. ([#284](https://github.com/danjdewhurst/story-skills/issues/284))

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

[Unreleased]: https://github.com/danjdewhurst/story-skills/compare/v0.18.0...HEAD
[0.18.0]: https://github.com/danjdewhurst/story-skills/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/danjdewhurst/story-skills/compare/v0.16.0...v0.17.0
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

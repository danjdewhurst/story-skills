# Writing in other languages

Story Skills works for a book in any language. One field, `language` in `story.md`, tells the skills which language to draft and edit in, and tells the `story` CLI how to count, split sentences, find dialogue, sort names, and typeset the builds. This page sums up what works for each language and script, what does not yet, and how to set a book up.

Three example projects show a book in each kind of script: [`quatre-heures-dix-sept`](../examples/quatre-heures-dix-sept/) in French, [`kirimi-eki-no-wasuremono`](../examples/kirimi-eki-no-wasuremono/) in Japanese (counted in characters and set vertically), and [`laysat-lil-bay`](../examples/laysat-lil-bay/) in Arabic (right to left).

## Contents

- [Set the book's language](#set-the-books-language)
- [What works in every language](#what-works-in-every-language)
- [Word lists: English, Spanish, French, and German](#word-lists-english-spanish-french-and-german)
- [By language and script](#by-language-and-script)
- [Counting words or characters](#counting-words-or-characters)
- [Dialogue and sentences](#dialogue-and-sentences)
- [Builds: labels, fonts, direction, and vertical text](#builds-labels-fonts-direction-and-vertical-text)
- [Ids for names in other scripts](#ids-for-names-in-other-scripts)
- [Extending the checks with the style sheet](#extending-the-checks-with-the-style-sheet)
- [The skills](#the-skills)
- [Contributing a language pack](#contributing-a-language-pack)

## Set the book's language

`language` is a [BCP 47](https://www.rfc-editor.org/info/bcp47) tag: `fr`, `fr-CA`, `ja`, `ar`, `pt-BR`, `zh-Hant`, `sr-Latn`. A book without one is English. Every field but `language` is optional:

```yaml
---
title: 霧見駅の忘れもの
language: ja
count-unit: characters
target-characters: 2000
writing-mode: vertical
chapter-numerals: native
labels:
  - chapter: 第{n}話
---
```

`count-unit` is `characters` by default for Chinese and Japanese and `words` for every other language, so set it only to count the other way. `target-characters` is the length target for a book counted in characters. `writing-mode: vertical` is for Japanese, Chinese, or Korean only. `chapter-numerals: native` writes chapter numbers in kanji (`第十二話`). `labels` replaces any generated build text, here the chapter heading. The CLI's YAML has no comments, so keep notes out of the frontmatter.

- `story init` has no `--language` flag. The `story-init` skill asks for the language and writes it into `story.md`; by hand, add the line after init. `story init --follows` or `--precedes` copies the linked book's `language`.
- `story import --language <tag>` writes `language` to the new `story.md` and splits the manuscript on that language's chapter headings: `Chapter` in English, `Capítulo` in Spanish, `Chapitre` in French, and `Kapitel` in German, with spelled-out numbers (`Chapitre vingt et un`). In other languages, import a folder with one file per chapter.
- `story validate` errors on a value that is not a tag (`english`, `fr_FR`), on an unsupported `writing-mode` or `count-unit`, and on a `labels` field that is not a list of `key: text` entries. It warns about a label key it does not know (`unknown-label`), which builds ignore. A set but invalid tag still picks its language by the first subtag, never English.
- For a book not in English, set `dialect: unspecified` in `style-sheet.md`: the British and American spelling pairs are English.

The tag is read the same way on every system: an old or three-letter code counts as its modern one (`iw` is Hebrew, `jpn` Japanese, `eng` English), `zh-yue` is Cantonese, and a grandfathered tag such as `en-GB-oed` takes its modern form. [Publishing metadata](project-format.md#publishing-metadata) lists every field.

## What works in every language

Most of the CLI never reads prose as language. Validation, registries, links and backlinks, `story continuity` (deaths, casts, promises, questions, clues, prop custody, the clock and travel time, state), `story timeline`, `story pacing`, `story clues`, `story knowledge`, `story context`, `story series`, and `story diagram` work on ids, dates, and frontmatter, and behave the same in every language. The three examples pass all of them with no warnings.

These read the text, and follow the book's language:

- **Counting.** Every script is counted, including those written without spaces between words. See [Counting words or characters](#counting-words-or-characters).
- **Sentences and dialogue.** `story prose` sentence counts, the synopsis, and `story voices` split sentences and find speech with the language's punctuation and quote marks. See [Dialogue and sentences](#dialogue-and-sentences).
- **Sorting and casing.** Names, titles, and word lists shown to you sort in the language (Swedish puts `Åsa` after `Zorn`), and words are lower-cased in it before they are compared, so Turkish `IŞIK` and `ışık` are the same word. Ids and file names sort the same in every language. See [Sorting, casing, and numbers](continuity.md#sorting-casing-and-numbers).
- **The style sheet.** `watch-words` and `preferred` spellings in `style-sheet.md`, and a character's `voice-words` and `voice-avoid`, are counted as whole words in any spaced script. In Chinese, Japanese, and Thai text, all four match inside the sentence, at the word boundaries `story wordcount` uses (see [Extending the checks with the style sheet](#extending-the-checks-with-the-style-sheet)).
- **Builds.** Every reader-facing string (chapter headings, the contents, the copyright page, the review copy's notes) comes out in the language, and the fonts, direction, and layout follow its script.

## Word lists: English, Spanish, French, and German

`story prose`, `story voices`, `story names`, and `story import` also run checks that need word lists: filter words, manner adverbs, plain dialogue tags and said-bookisms, speech verbs and pronouns, contractions, the stopwords behind echoes, repeated phrases, and signature words, the titles stripped from a name, and the chapter headings import splits on. These come from the language pack, and **English, Spanish (`es`), French (`fr`), and German (`de`) have full word lists**; a regional tag (`es-MX`, `fr-CA`, `de-CH`) uses its language's. Each pack holds that language's own words, not a translation of English's: French filter words in the passé simple (`sentit`, `regarda`), `-ment` adverbs, inverted tags (`dit-il`, `demanda-t-elle`) and tags set inside the speech. The French example's report:

```text
$ story prose examples/quatre-heures-dix-sept
Prose report: 3 chapters, 1079 words

chapters/chapter-01.md: La montre arrêtée (431 words)
  Sentences: 47, average 9.2 words, longest 36, spread 7.5
  Filter words: 6.2 per 1k narration words (regarda 1, sentait 1)
  -ment adverbs: 3.1 per 1k narration words (proprement 1)
  Dialogue tags: dit 1; said-bookisms: none
  Echoes within 30 words: heures 1
```

Where an English check has no equivalent, the pack leaves its list out and the check is skipped: German has no adverb ending, only English and German count contractions (Spanish `al` and French elision are compulsory), and the British and American spelling pairs (`dialect`) are English only.

Every other language has no word lists yet. A check that needs a list the pack lacks is skipped, never run with English words, and prints a note:

```text
$ story prose examples/laysat-lil-bay
Prose report: 3 chapters, 670 words
Note: Filter words skipped: no filterWords list for language ar
Note: Adverbs skipped: no adverbSuffixes or adverbExceptions list for language ar
Note: Dialogue tags skipped: no plainTags, saidBookisms, or beatPronouns list for language ar
Note: Echoes skipped: no echoStopwords list for language ar
Note: Repeated phrases skipped: no phraseStopwords list for language ar
```

What still runs: sentence counts and lengths, the style sheet's watch words and `preferred` spellings, the baseline's sentence, paragraph, and dialogue measures, and similar character names. `story voices` attributes speech by action beats alone (a character named in the narration around the line), and compares characters on sentence length, questions, and exclamations. `--json` lists what was skipped in `data.skipped`, and skipping never changes the exit code. A book can supply the missing lists itself; see [Extending the checks with the style sheet](#extending-the-checks-with-the-style-sheet). [Books not in English](continuity.md#books-not-in-english) has every rule. The writing skills do a skipped pass by reading instead.

## By language and script

| Language or script | Counted in | Dialogue the CLI reads | Build labels | Fonts and layout | Ids from names |
|--------------------|-----------|------------------------|--------------|------------------|----------------|
| English (`en`) | words | curly and straight quotes only | English | Latin, as before | ASCII slug |
| French (`fr`), Spanish (`es`) | words | the common marks, with French tags inside guillemets or dash dialogue | translated | Latin, as English | accents dropped (`Émile` is `emile`) |
| Italian, Portuguese (`pt`, `pt-PT`), Dutch, Polish, Turkish | words | the common marks | translated | Latin, as English | accents dropped |
| German (`de`), Danish (`da`), Swiss German (`de-CH`) | words | `„…“` and `»…«` (German and Danish), `«…»` (Swiss), with curly and straight quotes | translated for German | Latin | accents dropped |
| Swedish (`sv`), Finnish (`fi`) | words | `”…”`, `»…»`, and a leading en or em dash, where a dash after a finished line starts a new speaker | translated for Swedish | Latin | accents dropped |
| Russian, Ukrainian, other Cyrillic; Greek | words | the common marks | translated for Russian and Ukrainian | Cyrillic and Greek font stacks | transliterated (`Пётр` is `petr`); a letter outside the tables (Kazakh `қ`) needs `--id` |
| Japanese (`ja`) | characters | `「…」`, `『…』`, `〝…〟`, curly and straight quotes | translated | Japanese fonts; vertical text with `writing-mode: vertical` | `--id` needed |
| Chinese (`zh`, `zh-Hans`, `zh-Hant`, `zh-TW`, `cmn`, `yue`, `lzh`) | characters | the common marks, with no dialogue dash | translated, in Simplified or Traditional characters as the script subtag, then the region, says | Simplified or Traditional fonts; vertical text | `--id` needed |
| Korean (`ko`) | words | the common marks | translated | Korean fonts; vertical text | `--id` needed |
| Arabic, Persian (`ar`, `fa`), Hebrew (`he`) | words | the common marks; `؟` ends a sentence | translated | Arabic or Hebrew fonts, right to left | `--id` needed |
| Hindi and Devanagari (`hi`) | words | the common marks; `।` ends a sentence | translated for Hindi | Devanagari fonts | `--id` needed |
| Thai, Lao, Khmer, Burmese | words, split with a dictionary | the common marks | English | Thai fonts for Thai | `--id` needed |
| Any other language | words | the common marks | English | from the tag's script subtag or the language's usual script, else Latin | ASCII slug, or `--id` |

*The common marks* are curly and straight quotes, guillemets (`« »`, `‹ ›`), low-high quotes (`„…“`, `„…”`), corner brackets (`「」`, `『』`), and a leading em dash. Each language takes its sentence ends, quote marks, and dialogue dash from its own pack, or from the generic base pack when it has none; English, Spanish, French, and German also have the [word lists](#word-lists-english-spanish-french-and-german).

## Counting words or characters

- **Spaced scripts** (Latin, Cyrillic, Greek, Arabic, Hebrew, Armenian, Devanagari, Hangul) count words between spaces and punctuation. Marks set inside a word keep it one word: an apostrophe or hyphen, the Hebrew maqaf, geresh, and gershayim (`בית־ספר`, `צה״ל`), and the Armenian question, exclamation, and emphasis marks (`Ո՞վ`). See [How words are counted](project-format.md#how-words-are-counted).
- **Chinese and Japanese** count each character as a word in word-based analysis, as Word and Scrivener do. A book whose `language` is `zh` or `ja` also **measures its length in characters**: `story wordcount` prints characters, `--write` records `character-count` beside `word-count` in each chapter, and `story progress`, `story report`, the registry, the form check, the Shunn title page, the print page estimate, and the narration runtime all use characters, measured against `target-characters`. Punctuation counts, as it fills a square of manuscript paper; whitespace, including a full-width indent, does not.

  <!-- replay -->
  ```text
  $ story wordcount examples/kirimi-eki-no-wasuremono
  chapters/chapter-01.md: 712
  chapters/chapter-02.md: 539
  chapters/chapter-03.md: 721
  Total: 1972 characters
  ```

  `count-unit: words` keeps a Chinese or Japanese book in words; `count-unit: characters` counts another language in characters (without form ranges). [Counting in characters](project-format.md#counting-in-characters) covers the rules and the sources for the character ranges.
- **Thai, Lao, Khmer, and Burmese** put no spaces between words either, so each run is split into words with the runtime's dictionary (`Intl.Segmenter`). Counts can shift slightly between Node and Bun versions.

## Dialogue and sentences

`story voices` finds speech in the book's own quote marks, and sentence splitting (`story prose`, the synopsis) uses its stops. None of this needs a word list:

- **Sentence ends.** `.`, `?`, `!`, and `…`; the full-width `。！？`, which need no space after them; Arabic `؟`, Urdu `۔`, the Devanagari danda `।` and `॥`, and the Ethiopic `።`. Spanish `¿` and `¡` open a sentence. In a script without capitals (Arabic, Hebrew, Devanagari, Chinese, Japanese, Korean, Thai), any letter can start a sentence. Thai marks no sentence ends, so a Thai paragraph counts as one sentence.
- **French spacing.** A guillemet may be set off by a space or a no-break space, as French sets it: `Il partit. « Quoi ? » demanda-t-il.` is two sentences, and `« Viens »` is the speech `Viens`.
- **Dialogue dashes.** A paragraph that opens with an em dash is dialogue up to the closing dash or tag, and speech resumes after the tag (`—Ya voy —dijo ella—. Espera.`). Swedish and Finnish also take an en dash, and a dash after a finished line starts a new speaker. Chinese and Japanese read no leading dash as dialogue.
- **Names in unspaced scripts** are found inside the text around them, so `「行こう」とミナは言った。` is Mina's line, and `voice-words` such as `いいんだ` match inside a sentence.

[Sentences and dialogue in other languages](continuity.md#sentences-and-dialogue-in-other-languages) gives every rule. To choose and record the book's dialogue punctuation, the line-editing skill's [language conventions](../skills/line-editing/references/language-conventions.md) list the usual quote marks, dialogue dashes, and spacing for over twenty languages.

## Builds: labels, fonts, direction, and vertical text

**Labels.** Chapter headings and every other generated string come from the language pack, in Arabic, Chinese (Simplified, and Traditional for `zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO`, Cantonese, and Classical Chinese), Dutch, French, German, Hebrew, Hindi, Italian, Japanese, Korean, Persian, Polish, Portuguese (Brazilian, and European for `pt-PT`), Russian, Spanish, Swedish, Turkish, and Ukrainian. Each follows its language's conventions: `Chapitre 1 : La montre arrêtée` with a no-break space, `第1章　最後の日` with an ideographic space, `الفصل 1: المخطوطة الخضراء`. Any other language gets English labels. Change any label with `labels` in `story.md`, one `key: text` entry per line; [Build labels](manuscripts.md#build-labels) lists every key. Have a native reader check the labels before you publish.

**Chapter numerals.** Chapter numbers are Western digits (`第1章`, `الفصل 1`) unless `story.md` sets `chapter-numerals: native`, which writes them in the language's own numerals in every heading and table of contents: kanji in Japanese (`第十二章`, `第百一章`), hanzi in Chinese (`第十二章`, `第一百零一章`), and the script's digits in Arabic (`الفصل ١٢`), Persian and Urdu (`۱۲`), Hindi (`१२`), Thai (`๑๒`), and other scripts with digits of their own. File names, EPUB ids, and paragraph labels keep Western digits. The Japanese example sets it, so its vertical headings read `第一章` rather than a sideways `1`. `story validate` reports `unsupported-chapter-numerals` for a language without numerals of its own, such as English or Korean. [Chapter numerals](manuscripts.md#chapter-numerals) has the full table.

**Fonts and capitals.** The EPUB, HTML review copy, and print interior name fonts for Japanese, Simplified and Traditional Chinese, Korean, Arabic, Hebrew, Devanagari, Thai, Cherokee, and Cyrillic and Greek. A script without capitals drops the print interior's small caps, enlarged first letter, and italic running heads. A Latin-script book builds exactly as an English one does.

**Right to left.** Arabic, Persian, Hebrew, Urdu, and the other right-to-left languages, or any tag with an Arabic or Hebrew script subtag, set `dir="rtl"` in the EPUB, HTML, and print builds, turn the EPUB's pages right to left, open the print interior from the right, and mark the DOCX paragraphs and section right to left.

**Vertical text.** `writing-mode: vertical` sets a Japanese, Chinese, or Korean book in columns read top to bottom and right to left, in the EPUB (with Kindle's writing-mode meta), the HTML review copy, the print interior, and the DOCX. Set numbers in kanji or hanzi in vertical prose, as the Japanese example's style sheet does. `story validate` reports `unsupported-writing-mode` for any other language.

**DOCX.** Any `language` but `en` is declared to Word, with an East Asian or complex-script font (MS Mincho, SimSun, PMingLiU, Batang, Mangal, or Tahoma) where the script needs one, so Word checks spelling and breaks lines for it.

[Typesetting other scripts](manuscripts.md#typesetting-other-scripts) has the font stacks and the vertical layout in full. The narration script times a book at the language's reading pace (300 characters a minute for Chinese and Japanese, an estimate for most other languages); its headings and notes, the metadata sheet, and Fountain's scene headings stay in English, as text for you rather than for readers.

## Ids for names in other scripts

Ids stay ASCII kebab-case in every language, so file names and references work everywhere.

- Accented Latin letters lose their accents: `story add character "Émile Marchal"` writes `characters/emile-marchal.md`.
- Cyrillic and Greek names are transliterated: `Пётр Иванов` gives `petr-ivanov`, `Ολυμπία` gives `olympia`. The tables are in [Transliteration](project-format.md#transliteration). A name with a letter the tables lack, such as Kazakh `қ`, is not transliterated at all and needs `--id`.
- Names in any other script (Chinese, Japanese, Korean, Arabic, Hebrew, Devanagari, Thai) need an id from you:

  ```text
  $ story add character "佐伯ミナ"
  Cannot derive a kebab-case id from character name "佐伯ミナ": pass --id with a kebab-case id, or use a name containing ASCII letters or digits
  $ story add character "佐伯ミナ" --id saeki-mina
  ```

  A romanisation makes a readable id: the Japanese example uses `morita-haruka` for 森田遥 and `kirimi-eki` for 霧見駅, the Arabic one `salma-haddad` for سلمى حدّاد. The `name` field keeps the name as written, and that is what builds, `story voices`, and `story names` use.

The story id comes from an ASCII title, or from the project folder's name when the title has none, so `story init "霧見駅の忘れもの" --dir kirimi-eki-no-wasuremono` gives the story id `kirimi-eki-no-wasuremono`.

## Extending the checks with the style sheet

`style-sheet.md` teaches the checks about one book, in any language. Its lists are matched in the book's casing:

```yaml
---
type: style-sheet
dialect: unspecified
preferred:
  - use: Saint-Claude
    avoid: St-Claude
watch-words:
  - soudain
  - sembla
add-words:
  - said-bookisms: grommela, siffla
replace-words:
  - filter-words: sentit, vit, entendit, remarqua
---
```

- `watch-words` counts each word or phrase in every chapter, as a whole word: the French example watches *soudain* and *sembla*, the Arabic one فجأة and شعرت. An Arabic word with a prefix joined to it (وفجأة) is a different word to the count, so list that form too if it matters.
- `preferred` flags each `avoid` spelling: `St-Claude` for `Saint-Claude` in the French example.
- In Chinese, Japanese, and Thai, which put no spaces between words, watch words and `preferred` spellings match inside the sentence, at the word boundaries `story wordcount` uses: a Chinese or Japanese word at any character, a Thai one only where the dictionary splits words, so `แม` is not counted inside `แมว`. The Japanese example lists 思わず, ふと, and `片づけ` over `片付け`; its chapters use none of them, so `story prose` reports nothing.
- `add-words` adds words to any of the pack's word lists, and `replace-words` replaces a list (`[]` empties it). Either can supply a list for a language with no pack lists, which turns on the check that needs it: an Italian book with `- filter-words: sentì, vide, udì` under `add-words` gets a filter-word count. [Word lists](project-format.md#word-lists) names every list and what it needs; `story validate` warns `unknown-word-list` about a name it does not know.
- A character's `voice-words` and `voice-avoid` give `story voices` the phrases that character does and never says, matched inside unspaced Chinese, Japanese, and Thai text too.

Record the rest of the book's conventions (quote marks, spacing, numbers, forms of address) in the style sheet's prose sections, where the skills read them.

## The skills

The drafting, editing, and critique skills (chapter-writing, discovery-drafting, scene-craft, voice-style, verse-craft, revision-continuity, line-editing, and reader-panel) read `language` and write, edit, and critique in it. Craft advice built on English word lists, such as filter words, `-ly` adverbs, and *said*, is labelled as English, and where a CLI check is skipped for the book's language the skill does that pass by reading. story-init asks for the language; voice-style and line-editing settle the dialogue punctuation with you and record it in the style sheet; verse-craft scans by the language's own tradition; publishing and submission mark which conventions belong to the English-language market. [Writing in another language](writing-workflows.md#writing-in-another-language) covers the workflow, and the [Skills catalogue](skills.md#stories-in-other-languages) describes each skill.

The repository's [evals](https://github.com/danjdewhurst/story-skills/blob/main/evals/README.md) include drafting and line-editing fixtures in French, Japanese, and Arabic, seeded from the three example projects.

## Contributing a language pack

A language pack is a plain data module in `src/languages/`: the language's script, whether it has capitals, how its words are found, its sentence ends, quote marks, and dialogue dash, its count unit, its narration pace, its build labels, and the word lists the checks use. A pack can hold any of these; a check whose lists it lacks is skipped. [Adding a language pack](development.md#adding-a-language-pack) in the Development guide walks through it step by step: the file, its word lists, the lists that do not carry over, the hooks a language may need, registering it, its fixture tests, and its documentation; [Language packs](development.md#language-packs) explains how packs are resolved and layered, and how to add a build label. Labels and word lists should come from a native speaker, and a pack's lists should be that language's own, never a translation of the English ones.

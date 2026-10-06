# Writers: start here

This page is for writers who use Claude in a web browser or the Claude app and have never opened a terminal. You can use Story Skills without installing anything: download a skill, upload it to Claude, and ask for help with your book in plain words.

If you are comfortable with a terminal, or you use Claude Code, Codex, or another coding agent, [Getting started](getting-started.md) has the full install and the `story` command-line tool.

## Contents

- [What you need](#what-you-need)
- [1. Download the skills](#1-download-the-skills)
- [2. Upload a skill to Claude](#2-upload-a-skill-to-claude)
- [3. Try it](#3-try-it)
- [What works without a terminal](#what-works-without-a-terminal)
- [What needs a terminal](#what-needs-a-terminal)
- [Keeping your book safe between chats](#keeping-your-book-safe-between-chats)
- [Updating a skill](#updating-a-skill)
- [Other chat assistants](#other-chat-assistants)

## What you need

- A Claude account on claude.ai. Skills work on the Free, Pro, Max, Team, and Enterprise plans.
- **Code execution** turned on in Claude's settings. Skills need it. Claude's help article [Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude) shows where the switch is.

## 1. Download the skills

Each skill is a separate zip file. Download them from the [latest release](https://github.com/danjdewhurst/story-skills/releases/latest): open **Assets** at the bottom of the release and click a file to download it. Don't unzip it; Claude wants the zip as it is. Skill zips come with releases after 0.21.0.

You don't need all 24. This set covers starting a book, drafting it, and keeping it tidy:

| Download | What it does |
|----------|--------------|
| [premise-workshop.zip](https://github.com/danjdewhurst/story-skills/releases/latest/download/premise-workshop.zip) | Tests whether an idea will carry a book, and helps you pick its form and title |
| [story-init.zip](https://github.com/danjdewhurst/story-skills/releases/latest/download/story-init.zip) | Sets up a new book: the story bible, its genre, and its folders |
| [character-management.zip](https://github.com/danjdewhurst/story-skills/releases/latest/download/character-management.zip) | Creates and develops characters and their relationships |
| [worldbuilding.zip](https://github.com/danjdewhurst/story-skills/releases/latest/download/worldbuilding.zip) | Places, history, cultures, and the rules of your world |
| [plot-structure.zip](https://github.com/danjdewhurst/story-skills/releases/latest/download/plot-structure.zip) | Outlines, story structure, and pacing |
| [chapter-writing.zip](https://github.com/danjdewhurst/story-skills/releases/latest/download/chapter-writing.zip) | Drafts chapters that stay true to what you have already decided |
| [revision-continuity.zip](https://github.com/danjdewhurst/story-skills/releases/latest/download/revision-continuity.zip) | Revision passes, and catching mistakes such as a character who died in chapter 2 turning up in chapter 4 |
| [story-maintenance.zip](https://github.com/danjdewhurst/story-skills/releases/latest/download/story-maintenance.zip) | The shared rules every other skill follows, and the checking tool. Upload this one whatever else you choose |

The other skills cover line editing, voice and style, scenes, theme, genre, research, feedback, editors, submitting to agents and magazines, self-publishing, series, poetry, branching stories, and adaptation. The [skills catalogue](skills.md#which-skill-do-i-want) says what each one is for; every one has a zip of the same name on the release page.

The release also has `all-skills.zip`. That one holds every skill at once and is for coding agents such as Claude Code. Claude's website takes one skill per upload, so it won't accept `all-skills.zip`.

## 2. Upload a skill to Claude

1. In Claude, open **Customize > Skills**.
2. Click **+**, then **Create skill**, then **Upload a skill**.
3. Choose one of the zip files you downloaded.
4. The skill appears in your list. Make sure its switch is on.

Repeat for each zip. Upload `story-maintenance` as well as the skills you want to use: the others look for its shared rules and its checking tool beside them. Each skill carries a short version of those rules, so it still works on its own, but it works best with `story-maintenance` there too.

If the upload fails, check you chose the zip file itself and not a folder you unzipped.

## 3. Try it

Start a new chat and ask in plain words. You don't need to name the skill; Claude picks the one that fits. For example:

- "I have an idea for a story about a lighthouse keeper who stops the light on purpose. Will it carry a novel?"
- "Start a new story. It's a cosy mystery set in a seaside village."
- "Create a character: the village doctor, who is hiding something."
- "Write chapter 1."

If Claude doesn't seem to use a skill, name it: "Use the chapter-writing skill to draft chapter 1."

## What works without a terminal

All the creative work:

- Testing a premise, outlining, and planning structure
- Creating characters, places, and the rules of your world
- Drafting chapters and scenes in your voice and your genre
- Revision passes, line editing, and reader-style feedback
- Query letters, synopses, and submission plans
- Planning a series, a translation, or an audio or screen adaptation

The skills write your book as a set of plain text files: a story bible, one file per character and place, and one per chapter. Claude keeps them consistent with each other as it works.

## What needs a terminal

The `story` checking tool is a small program. It counts words, rebuilds the lists of characters and chapters, and finds continuity mistakes exactly, and it builds the finished book as an EPUB or Word file. `story-maintenance` carries a copy of it, and Claude can sometimes run it inside the chat when all your book's files are in that chat. When it can't, Claude does the same checks by reading the files, which is slower and can miss things in a long book.

These need a terminal or a coding agent such as Claude Code:

- Running every check automatically after each change
- Building EPUB, Word (DOCX), standard manuscript, and print files reliably
- Keeping the book in a folder on your computer that Claude edits directly
- The GitHub automation that checks your book or drafts a chapter on a schedule ([Automation and CI](automation.md))

When you want those, [Getting started](getting-started.md) walks through the install. Your files carry over as they are.

## Keeping your book safe between chats

A chat on claude.ai doesn't keep files for the next chat. Each time Claude writes or changes a file, download it and keep it in one folder on your computer, named the way Claude named it (for example `characters/mara-voss.md`). When you start a new chat, upload the files that chat needs, such as `story.md` and the chapters around the one you are working on, or add the whole folder to a Claude Project so every chat in the project can read it.

## Updating a skill

New versions of the skills come out on the [releases page](https://github.com/danjdewhurst/story-skills/releases). To update one, delete it in **Customize > Skills**, download the new zip, and upload it again. The [changelog](../CHANGELOG.md) lists what changed in each version.

Each release also lists a checksums file and signed build records, so you can check a download is the one the project published. You don't need to, but [Getting started](getting-started.md#install-the-story-cli) shows how.

## Other chat assistants

Assistants without a skills upload, such as ChatGPT, can still use the instructions. Unzip a skill and add its `SKILL.md` and the files in its `references` folder to a project as knowledge, or paste `SKILL.md` into the project's instructions. The assistant reads them as guidance, but it won't pick the right skill for each request on its own, so tell it which one to follow.

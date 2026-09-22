# First 20 Minutes With Story Skills

This walkthrough shows the complete loop: initialize, add story bible entities, draft a chapter shell, record scene continuity, check the project, and build exports.

## 0. Install Prerequisites

```shell
bun install
bun run story -- --help
```

All `story ...` commands below also run as `bun run story -- ...` from the repository checkout. For copied-skill installs without the package, use the bundled fallback: `node skills/story-maintenance/scripts/story.js --help`.

## 1. Start The Project

```shell
story init "The Tide Room" \
  --genre mystery \
  --sub-genre coastal \
  --setting-era near-future \
  --pov third-person-limited \
  --tense past \
  --theme truth \
  --theme memory \
  --synopsis "A diver finds a sealed room under a storm-damaged harbor."
cd the-tide-room
```

## 2. Add The First Story Elements

```shell
story add character "Mara Quill" --role protagonist
story add location "Bellwether Reef" --type landmark --character mara-quill
story add faction "Harbor Council" --type government --member mara-quill --location bellwether-reef
story add artifact "Signal Lantern" --type technology --owner mara-quill --location bellwether-reef
story add arc "The Hidden Signal" --type main --character mara-quill --theme truth
```

## 3. Add A Chapter And Scene Record

```shell
story add chapter "The Bell Under The Reef" \
  --number 1 \
  --pov mara-quill \
  --location bellwether-reef \
  --character mara-quill \
  --arc the-hidden-signal

story add scene "Mara Finds The Lantern" \
  --chapter chapter-01 \
  --scene 1 \
  --pov mara-quill \
  --location bellwether-reef \
  --character mara-quill \
  --arc the-hidden-signal
```

Write the chapter prose directly in `chapters/chapter-01.md`. Keep scene continuity notes in `scenes/chapter-01-scene-01.md`.

## 4. Track Promises And Questions

```shell
story add question "Who sealed the room?" --introduced chapter-01 --character mara-quill
story add promise "The lantern contains a warning" --planted chapter-01 --arc the-hidden-signal --character mara-quill
story add term "Signal Lantern" --category artifact --alias lantern
```

## 5. Run The Authoring Loop

```shell
story wordcount . --write
story reindex .
story links .
story validate .
story continuity .
story prose .
story next .
story doctor .
```

Once the first chapter exists, fill in `style-sheet.md`: set `dialect: british` or `dialect: american`, add a `preferred` entry for each house spelling, and list the book's overused words under `watch-words`. `story prose .` then flags avoided spellings and reports filter words, adverbs, said-bookisms, echoes, sentence rhythm, and repeated phrases for every chapter.

Use `story next .` before a drafting session. Use `story doctor .` when something feels inconsistent or stale. Use `story continuity .` after every chapter to catch contradictions - dead characters reappearing, payoffs landing before their setup, stale story state - before a reader does.

## 6. Build The Manuscript

```shell
story export . --out manuscript.md
story build . --format markdown
story build . --format epub
story build . --format docx
```

Before a real build, add the pages around the chapters and a cover:

```shell
story add matter "Dedication"
story add matter "Acknowledgments" --placement back
```

Write each page's text in its `matter/` file, and set `heading: false` on the dedication so it prints without a title. Add `cover: cover.jpg` and `author: Your Name` to `story.md` so the EPUB carries a cover image and creator. Shunn manuscripts leave matter out.

The `dist/` outputs are disposable build artifacts. The source of truth remains the markdown project.

`story add` rebuilds the registries automatically, so there is no need to run `story reindex` after each add — reindex explicitly only after hand-editing files or renaming outside the CLI.

## 7. Go Further

- `git tag draft-1` (after committing) before a revision pass, then `story compare . --ref draft-1` to see which chapters the pass changed and by how much.
- `story progress . --log` after each session, with `target-words` and `deadline` in `story.md`, to track pace against the deadline.
- `story timeline .` to see dated scenes in story order, POV balance, and characters who drop out.
- `story add research "Topic" --used-in chapter-02` to record real-world facts with their sources.

- `story add clue "The torn page" --planted chapter-01 --payoff chapter-03` — track a plant/payoff pair alongside questions and promises.
- `story knowledge mara-quill --at chapter-01` — check what a character knew at a story point (from `knowledge-state` in `continuity/state.md`).
- `story synopsis --pages 1` — compress arcs into a mechanical 1-page synopsis (`--pages 3` for the longer form).
- `story series .` — once a sequel or prequel is linked with `story init "Book Two" --follows <path>`, order the books and check shared canon.
- `story migrate .` — upgrade an older project to the current schema.
- `continuity/exemptions.md` — log intentional findings (a `pattern` of at least 4 characters plus a `reason`); `story continuity` reports them as dismissed instead of errors.

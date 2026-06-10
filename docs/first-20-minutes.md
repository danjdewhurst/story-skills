# First 20 Minutes With Story Skills

This walkthrough shows the complete loop: initialize, add story bible entities, draft a chapter shell, record scene continuity, check the project, and build exports.

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
story next .
story doctor .
```

Use `story next .` before a drafting session. Use `story doctor .` when something feels inconsistent or stale. Use `story continuity .` after every chapter to catch contradictions - dead characters reappearing, payoffs landing before their setup, stale story state - before a reader does.

## 6. Build The Manuscript

```shell
story export . --out manuscript.md
story build . --format markdown
story build . --format epub
story build . --format docx
```

The `dist/` outputs are disposable build artifacts. The source of truth remains the markdown project.

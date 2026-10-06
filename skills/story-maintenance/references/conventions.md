# Story Conventions

These conventions apply across all story skills. Every `SKILL.md` links here and repeats a one-line summary, so a skill installed on its own without `story-maintenance` still has the essentials. `docs/concepts.md` explains them for users, and `docs/project-format.md` is the full schema reference.

## Files and identifiers

- **Kebab-case filenames** for all entity files (e.g., `sera-voss.md`, `ashen-citadel.md`)
- **YAML frontmatter** on every file in a story project for structured metadata (a standalone piece saved outside a project, such as a single poem, needs none)
- **Schema version** - `story.md` frontmatter includes `schema-version: 2`
- **Character identifiers** use the kebab-case filename without extension (e.g., `sera-voss`)
- **Scene identifiers** use `chapter-{NN}-scene-{NN}` and live in `scenes/`

## Project files

- **`_index.md`** files are authoritative registries for each domain
- **`story.md`** is the top-level bible read by all skills for context
- **`style-sheet.md`** records voice and house style; skills that write or revise prose read it
- **Continuity state** lives in `continuity/state.md`, with open questions, promises, and clues tracked under `continuity/questions/`, `continuity/promises/`, and `continuity/clues/`

## Links and casts

- **Bidirectional cross-links** - when referencing another entity, update both files
- **Death tracking** - when a character dies on the page, set `status: deceased` and `died-in: chapter-{NN}` so `story continuity` can flag posthumous appearances
- **`mentions` vs `characters`** - chapter and scene frontmatter lists characters present in-scene under `characters`; characters who are only referenced, remembered, recorded, or seen in flashback go under `mentions`

## Scripts

- **Markdown-first artifacts** - create and edit story content directly in the target `.md` files. Do not create project-local build scripts, generator scripts, or bulk writer scripts (for example `build-*.js`) to emit story files.
- **CLI helpers stay external** - the only JavaScript helper agents should run is the installed or bundled Story CLI (`story`, `bun run story --`, or `story-maintenance/scripts/story.js`) for deterministic maintenance. Do not copy it into the user's story project, and remove any unavoidable scratch helper before finishing.

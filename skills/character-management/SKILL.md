---
name: character-management
description: This skill should be used when the user asks to "create a character", "update a character", "add a character", "build a family tree", "character relationships", "character timeline", "character arc", "character profile", "relationship graph", "name a character", or needs to manage characters in a story project. NOT for character voices or dialogue style (use voice-style), or for a thematic arc's lie, truth, and arc type (use theme-craft).
---

# Character Management

## Overview

Create and manage rich character profiles for a story project. Each character is a markdown file with YAML frontmatter in the `characters/` directory. Characters are cross-referenced with other story elements through kebab-case identifiers.

## Prerequisites

A story project must already exist (created via the story-init skill). Verify by checking for `story.md` in the project root.

## Creating a Character

1. Read `story.md` for genre, themes, and tone context
2. Read `characters/_index.md` for existing characters
3. Ask for the character's name and role (protagonist, antagonist, supporting, minor, narrator, deuteragonist). Before settling the name, run `story names "{Name}"` (several candidates can be checked at once): it errors on an exact clash with any existing character, alias, location, faction, artifact, system, or glossary term, and warns about look-alikes and names sharing an initial with a major character. Invented names from a culture should follow its naming rules (see `references/naming-languages.md` in the `worldbuilding` skill)
4. Build the profile through conversation, exploring:
   - Appearance and distinguishing features
   - Personality, traits, and quirks
   - Backstory and formative events
   - Motivations (external wants vs internal needs)
   - Voice and speech patterns (ask for example dialogue), plus `voice-words` (words and phrases they reach for) and `voice-avoid` (words they would never say)
   - Pronunciation, when the name is invented or easily misread (`pronunciation: "SEER-sha"`)
   - Character arc (starting state, turning points, ending state)
   - Key life events for the timeline
5. Write the character file using the template in `references/character-template.md`
6. Save to `characters/{name-kebab}.md`, or use `story add character "{Name}" --role "{role}"` when the CLI is available. When the name has no ASCII letters or digits (`Пётр`, `李明`), choose the ASCII id yourself and pass it: `story add character "Пётр" --id petr --role supporting` keeps `name: Пётр` in the file
7. Update `characters/_index.md` registry table
8. If relationships reference existing characters, update those character files too
9. When CLI access is available, run the maintenance pass in the story root:

```shell
story reindex .
story links .
story validate .
```

## Updating a Character

1. Read the existing character file
2. Read `characters/_index.md` for context on other characters
3. Make the requested changes. If the change happens partway through the story (a scar, a new title, a turn to the other side), add a progression instead of editing the opening value (see Changes Over the Story)
4. If relationships changed, update the other character's file (bidirectional)
5. Update `characters/_index.md` if role or status changed
6. When CLI access is available, run `story reindex .`, `story links .`, and `story validate .`

## Changes Over the Story

A character file describes the character as the story opens. Record a change that happens in a later chapter as a progression, so an agent drafting an earlier chapter does not write it in too soon:

```yaml
progressions:
  - from: chapter-10
    field: scar
    value: "Jaw to collarbone, taken holding a door"
  - from: chapter-14
    field: role
    value: antagonist
```

- `from` is the first chapter where the new value holds. It may be a planned `chapter-NN` with no file yet
- `field` is kebab-case. It can be an existing single-value field (`status`, `role`, `arc`) or a new one (`scar`, `title`). List fields (`aliases`, `relationships`, `locations`, `tags`, voice lists) cannot change this way; record a shifted relationship as a progression on its own field, such as `field: standing-with-kael` with `value: estranged` under `progressions`, never as a top-level field (that would show from chapter 1)
- `value` is one value. `role` and `status` values must be ones the character file allows
- Keep entries in story order. Do not use a progression for a death: set `died-in` (see below)
- Before drafting or revising a chapter, run `story knowledge {id} --at chapter-NN` to see what the character knows and which changes already apply there, and write to that state rather than the opening frontmatter alone

After adding or editing progressions, run `story validate .` and `story links .`.

## Renaming or Killing Off a Character

To rename, run `story rename character {id} "{New Name}"`. It sets `name`, renames the file when the id changes, and rewrites the id in every frontmatter field and markdown link target. Prose and hand-written registry sections (such as Family Trees in `characters/_index.md`) keep the old display name: search for it (`grep -rn "Old Name" .`) and update each hit by hand, including chapter text and link labels.

To kill a character off:

1. Set `status: deceased` and `died-in: chapter-NN` in the character file
2. In every later chapter and scene, move the id from `characters` (and `pov`) to `mentions` where they appear only in memory, letters, or flashback
3. Run `story continuity .`: it reports any later chapter or scene that still lists them in its cast

Variants:

- **Planned death:** set `died-in` to an outline chapter and keep `status: alive`; set `status: deceased` when that chapter is drafted
- **Dead narrator (ghost, posthumous POV):** keep them as `pov` and also list them in `mentions`; that is not a posthumous appearance
- **Resurrection:** add `revived-in: chapter-NN`; casts from that chapter on are allowed again, and once it is drafted set `status: alive`
- **Non-linear books:** give chapters a `date` so deaths compare by story time, and give a dual-timeline book's chapters a `strand` so each timeline keeps its own clock
- Drop the character's `character-state` entry in `continuity/state.md` once the death is drafted and at or before `current-chapter`

After either change, run `story reindex .`, `story links .`, and `story validate .`.

## Managing Relationships

Reference `references/relationship-types.md` for the full list of relationship types and inverse pairs.

When adding a relationship:
- Add the relationship entry to the character's frontmatter
- Add the inverse relationship to the other character's frontmatter
- Update the Relationship Map section in `characters/_index.md`

## Family Trees and Relationship Graphs

Generate the relationship graph from character frontmatter instead of drawing it by hand:

```shell
story diagram relationships
story diagram relationships --out dist/relationships.mmd
```

It prints Mermaid source built from every character's `relationships`, with family edges styled distinctly so the family tree stands out from alliances and rivalries. Each pair gets one edge: parent, grandparent, aunt, and uncle draw an arrow from the elder side, other types draw an undirected line, and child-side types (child, grandchild, niece, nephew) are skipped, so the diagram cannot show a one-way relationship. GitHub, many editors, and mermaid.live render it. Use it to spot isolated characters and families missing a generation, and run `story links` to find one-way relationships and missing backlinks; regenerate it after relationship changes rather than editing the output.

Family trees are also maintained in the `characters/_index.md` under the "Family Trees" section. Format:

```markdown
## Family Trees

### {Family Name}
- **{Character Name}** ({status}) - [{Name}]({name-kebab}.md)
  - **{Child Name}** - [{Name}]({name-kebab}.md)
  - **{Child Name}** - [{Name}]({name-kebab}.md)
```

Indent children under parents. Note marriages/partnerships inline.

## Voice Fields

`voice-words` and `voice-avoid` are optional lists in character frontmatter that make a speaker's voice checkable:

```yaml
voice-words:
  - "reckon"
  - "love"
voice-avoid:
  - "awesome"
  - "literally"
```

Here "love" is a term of address ("all right, love"). Keep notes like that in prose, not as `#` comments in frontmatter; the parser keeps them as part of the value.

`story voices .` fingerprints each character's attributed dialogue (see the `voice-style` skill for how lines are attributed) and warns when they say a `voice-avoid` word, when a `voice-words` entry never appears, and when two characters' voices are near-identical. Keep these lists short (three to eight entries) and consistent with the Voice & Speech Patterns section and the style sheet's Character Voices line (see the `voice-style` skill).

## Cross-Referencing

- When a character is referenced in worldbuilding (e.g., a location's `notable-characters`), ensure the link exists both ways
- Character-location backlinks live in the character file's `locations` frontmatter list
- Faction memberships live in `worldbuilding/factions/{faction-kebab}.md` under `members`
- Artifact ownership can reference a character id in `worldbuilding/artifacts/{artifact-kebab}.md`
- When a character appears in a plot arc, ensure they're listed in the arc's `characters` frontmatter
- Character tags should be consistent across the project (e.g., if `magic-user` is used, always use that exact tag)

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder. If no CLI is available, perform the registry, backlink, and word-count checks manually.

## Reference Files

- **`references/character-template.md`** - Full blank template for character profiles, including arc-type, lie/truth/ghost-wound fields and the Antagonist Design section
- **`references/relationship-types.md`** - Complete relationship type reference with inverse pairs
- **`references/ensemble-cast.md`** - Managing multi-character casts: anchor character, A/B/C story braiding, thematic relevance, merge-characters discipline
- **`references/supporting-characters.md`** - Role vocabulary (mentor, foil, confidant, love interest, comic relief, threshold guardian) and requirements for supporting roles

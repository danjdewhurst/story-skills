---
name: worldbuilding
description: This skill should be used when the user asks to "create a location", "add a location", "magic system", "political system", "build the world", "add culture", "world history", "technology system", "religion", "economy", "map", "travel times", "routes", "calendar", "moons", "seasons", "naming language", "conlang names", "trade routes", "supply lines", "magic cost", or wants to develop any aspect of a story's world and setting.
---

# Worldbuilding

## Overview

Create and manage world elements for a story project. Locations, systems (magic, politics, technology, etc.), factions, and artifacts are stored as markdown files in the `worldbuilding/` directory with YAML frontmatter. All elements cross-reference characters and other story elements.

## Prerequisites

A story project must already exist (created via the story-init skill). Verify by checking for `story.md` in the project root.

## Creating a Location

1. Read `story.md` for genre, era, and tone context
2. Read `worldbuilding/_index.md` for existing locations and systems
3. Ask for the location's name and type (city, fortress, wilderness, etc.)
4. Build the location through conversation, covering:
   - Physical description and atmosphere
   - History relevant to the story
   - Culture and customs of inhabitants
   - Notable features characters will interact with
   - Current state at story's timeline
   - Routes to other locations: travel time in hours and mode (see `references/maps-and-routes.md`)
   - Pronunciation, if the name is invented or easily misread (`pronunciation: "KEL-ah-mar"`)
5. Before settling an invented name, run `story names "{Candidate}"` to catch clashes and look-alikes (see `references/naming-languages.md`)
6. Write the file using `references/location-template.md`
7. Save to `worldbuilding/locations/{name-kebab}.md`
8. Update `worldbuilding/_index.md` locations table
9. If notable characters are listed, verify those character files exist and add this location's kebab-case identifier to each character file's `locations` frontmatter list
10. When CLI access is available, run `story reindex .`, `story links .`, and `story validate .`

## Maps, Routes, and Travel

Record travel between locations as `routes` on the location file, not in prose notes, so the CLI can check it:

```yaml
routes:
  - to: harbor-district
    hours: 1.5
    mode: on foot
  - to: saltmarsh-fort
    hours: 9
    mode: coach
```

- `to` is a location id; `story links .` checks it exists.
- A route is two-way unless the other location declares its own route back (for example, uphill slower than down).
- `story continuity .` errors when a character appears in two dated scenes at locations joined by a route and the story time between them is shorter than the route's `hours`.
- `story diagram locations` prints the route network as a Mermaid map-graph with edges labelled in hours; add `--out dist/locations.mmd` to save it. Use it to spot unreachable places and implausible shortcuts.

Use the travel speeds table in `references/economy-logistics.md` to set plausible hours, and `references/maps-and-routes.md` for the full workflow.

## Creating a System

1. Read `story.md` for genre and themes context
2. Read `worldbuilding/_index.md` for existing systems
3. Identify the system type and consult `references/world-element-types.md` for the relevant prompts. For calendars, naming languages, economies, and magic costs, also use `references/calendars.md`, `references/naming-languages.md`, and `references/economy-logistics.md`
4. Build the system through conversation, addressing the key questions for that type
5. Write the file using `references/system-template.md`
6. Save to `worldbuilding/systems/{name-kebab}.md`
7. Update `worldbuilding/_index.md` systems table
8. Cross-reference with characters who interact with the system (e.g., magic-users for a magic system)
9. When CLI access is available, run `story reindex .`, `story links .`, and `story validate .`

## Creating A Faction

Use `story add faction "{Faction Name}" --type "{family|guild|government|military|religion|company|community|criminal|other}"` when the CLI is available. Otherwise create `worldbuilding/factions/{name-kebab}.md` with frontmatter fields `name`, `type`, `status`, `members`, `locations`, and `tags`.

Cover:
- Purpose and ideology
- Power base, resources, and territory
- Important members
- Conflicts and pressure points

Then:
1. Save to `worldbuilding/factions/{name-kebab}.md`
2. Update the Factions table in `worldbuilding/_index.md`
3. If members are listed, verify those character files exist
4. When CLI access is available, run `story reindex .`, `story links .`, and `story validate .`

## Creating An Artifact

Use `story add artifact "{Artifact Name}" --type "{object|weapon|document|technology|relic|symbol|resource|other}"` when the CLI is available. Otherwise create `worldbuilding/artifacts/{name-kebab}.md` with frontmatter fields `name`, `type`, `status`, `owner`, `location`, and `tags`.

Cover:
- Description and recognition details
- Function, constraints, and costs
- History and prior owners
- Current owner/location state

Then:
1. Save to `worldbuilding/artifacts/{name-kebab}.md`
2. Update the Artifacts table in `worldbuilding/_index.md`
3. If an owner or location is listed, verify those files exist and cross-reference back
4. When CLI access is available, run `story reindex .`, `story links .`, and `story validate .`

## Updating World Elements

1. Read the existing file
2. Make the requested changes
3. If cross-references changed, update the linked files
4. Update `worldbuilding/_index.md` if name, type, or status changed
5. When CLI access is available, run `story reindex .`, `story links .`, and `story validate .`

## Cross-Referencing

- Locations reference characters via `notable-characters` in frontmatter
- Characters reference locations via `locations` in frontmatter
- Factions reference character members and locations
- Artifacts reference an owner character or faction and a current location
- Systems reference practitioners via character tags
- Location `routes` reference other locations by id
- Invented names across characters, locations, factions, artifacts, and glossary terms may carry a `pronunciation`; `story build --format narration` gathers them into a pronunciation guide for audiobook narrators
- When a location is used in a chapter, the chapter's frontmatter `locations` field links back
- Keep the `worldbuilding/_index.md` world overview section current as elements are added

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder. If no CLI is available, perform the registry, backlink, and word-count checks manually.

## Reference Files

- **`references/location-template.md`** - Template for location files
- **`references/system-template.md`** - Template for system files
- **`references/faction-template.md`** - Template for faction files
- **`references/artifact-template.md`** - Template for artifact/object files
- **`references/world-element-types.md`** - Detailed prompts for each system type (magic, political, technology, religion, economic, military, social)
- **`references/maps-and-routes.md`** - Recording `routes`, the `story diagram locations` map-graph, and the continuity travel check
- **`references/calendars.md`** - Recording a custom calendar, seasons, and moons as a system file and dating scenes consistently
- **`references/naming-languages.md`** - Phonology sketches, naming rules per culture, pronunciation, and the `story names` collision check
- **`references/economy-logistics.md`** - Prices and wages, supply lines, magic and technology costs, and a travel speeds table by mode

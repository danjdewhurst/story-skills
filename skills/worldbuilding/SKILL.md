---
name: worldbuilding
description: This skill should be used when the user asks to "create a location", "add a location", "magic system", "political system", "build the world", "add culture", "world history", "technology system", "religion", "economy", or wants to develop any aspect of a story's world and setting.
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
5. Write the file using `references/location-template.md`
6. Save to `worldbuilding/locations/{name-kebab}.md`
7. Update `worldbuilding/_index.md` locations table
8. If notable characters are listed, verify those character files exist and add this location's kebab-case identifier to each character file's `locations` frontmatter list
9. When CLI access is available, run `story reindex .`, `story links .`, and `story validate .`

## Creating a System

1. Read `story.md` for genre and themes context
2. Read `worldbuilding/_index.md` for existing systems
3. Identify the system type and consult `references/world-element-types.md` for the relevant prompts
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

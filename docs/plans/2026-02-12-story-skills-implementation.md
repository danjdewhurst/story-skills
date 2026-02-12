# Story Skills Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Claude Code plugin with 5 cross-referenced skills for end-to-end story writing in markdown.

**Architecture:** Skill-focused plugin with no hooks, MCP servers, or commands. Each skill has a lean SKILL.md with references/ for templates and detailed guides. Skills cross-reference each other via shared conventions (YAML frontmatter, `_index.md` registries, kebab-case identifiers).

**Tech Stack:** Markdown, YAML frontmatter, Claude Code plugin system (auto-discovery)

**Design doc:** `docs/plans/2026-02-12-story-skills-design.md`

---

### Task 1: Plugin Scaffold

**Files:**
- Create: `.claude-plugin/plugin.json`

**Step 1: Create plugin manifest**

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "story-skills",
  "version": "0.1.0",
  "description": "A suite of cross-referenced skills for end-to-end story writing powered by markdown. Covers story initialization, character management, worldbuilding, plot structure, and chapter writing.",
  "author": {
    "name": "Dan"
  },
  "license": "MIT",
  "keywords": ["story", "writing", "fiction", "characters", "worldbuilding", "chapters"]
}
```

**Step 2: Create skill directories**

```bash
mkdir -p skills/story-init
mkdir -p skills/character-management/references
mkdir -p skills/worldbuilding/references
mkdir -p skills/plot-structure/references
mkdir -p skills/chapter-writing/references
```

**Step 3: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat: scaffold story-skills plugin with directory structure"
```

---

### Task 2: story-init Skill

**Files:**
- Create: `skills/story-init/SKILL.md`

**Step 1: Write SKILL.md**

Create `skills/story-init/SKILL.md`:

````markdown
---
name: story-init
description: This skill should be used when the user asks to "start a new story", "initialize a story project", "create a story", "new book", "set up a story", or wants to begin a new fiction writing project from scratch.
---

# Story Initialization

## Overview

Initialize a new story project with a structured markdown folder layout. Creates the story bible, character registry, worldbuilding index, plot structure, and chapter tracker - all as cross-referenced markdown files with YAML frontmatter.

## When to Use

- Starting a new story, book, or fiction project
- Setting up the folder structure for an existing story idea
- NOT for adding to an existing story project (use the domain-specific skills instead)

## Workflow

1. Ask for basic story information:
   - Title
   - Genre and sub-genre
   - Brief synopsis (2-3 sentences)
   - Setting era/time period
   - Key themes (2-4)
   - POV style (first-person, third-person-limited, third-person-omniscient)
   - Tense (past, present)

2. Create the folder structure at the current working directory:

```
{story-title-kebab}/
├── story.md
├── characters/
│   └── _index.md
├── worldbuilding/
│   ├── _index.md
│   ├── locations/
│   └── systems/
├── plot/
│   ├── _index.md
│   ├── arcs/
│   └── timeline.md
└── chapters/
    └── _index.md
```

3. Populate `story.md` with the story bible:

```yaml
---
title: "{Title}"
genre: {genre}
sub-genre: {sub-genre}
setting-era: {era}
status: planning
themes:
  - {theme-1}
  - {theme-2}
pov: {pov-style}
tense: {tense}
---
```

Below the frontmatter, include sections:
- **Synopsis** - the 2-3 sentence synopsis provided
- **Tone & Style** - brief notes on the story's voice (derive from genre/themes)
- **Notes** - empty section for the user to fill in

4. Populate each `_index.md` with an empty registry:

**`characters/_index.md`:**
```markdown
---
type: character-registry
story: {story-title-kebab}
---

# Characters

## Registry

| Name | Role | Status | File |
|------|------|--------|------|
| *No characters yet* | | | |

## Family Trees

*No family trees defined yet.*

## Relationship Map

*No relationships defined yet.*
```

**`worldbuilding/_index.md`:**
```markdown
---
type: world-registry
story: {story-title-kebab}
---

# Worldbuilding

## World Overview

*Describe the world at a high level here.*

## Locations

| Name | Type | Region | File |
|------|------|--------|------|
| *No locations yet* | | | |

## Systems

| Name | Type | File |
|------|------|------|
| *No systems yet* | | |
```

**`plot/_index.md`:**
```markdown
---
type: plot-registry
story: {story-title-kebab}
structure: three-act
---

# Plot Structure

## Story Structure

**Model:** Three-Act Structure (adjust as needed)

## Arcs

| Name | Type | Status | File |
|------|------|--------|------|
| *No arcs yet* | | | |

## Theme Tracking

| Theme | Arcs | Chapters |
|-------|------|----------|
| *No themes tracked yet* | | |
```

**`plot/timeline.md`:**
```markdown
---
type: timeline
story: {story-title-kebab}
---

# Story Timeline

| When | Event | Arc | Chapter |
|------|-------|-----|---------|
| *No events yet* | | | |
```

**`chapters/_index.md`:**
```markdown
---
type: chapter-registry
story: {story-title-kebab}
---

# Chapters

## Registry

| # | Title | POV | Status | Word Count | File |
|---|-------|-----|--------|------------|------|
| *No chapters yet* | | | | | |

## Total Word Count: 0
```

5. Present a summary of what was created and suggest next steps:
   - "Add your first character" (triggers character-management skill)
   - "Start worldbuilding" (triggers worldbuilding skill)
   - "Define your plot structure" (triggers plot-structure skill)

## Conventions

These conventions apply across ALL story skills:

- **Kebab-case filenames** for all entity files (e.g., `sera-voss.md`, `ashen-citadel.md`)
- **YAML frontmatter** on every file for structured metadata
- **`_index.md`** files are authoritative registries for each domain
- **`story.md`** is the top-level bible read by all skills for context
- **Bidirectional cross-links** - when referencing another entity, update both files
- **Character identifiers** use the kebab-case filename without extension (e.g., `sera-voss`)
````

**Step 2: Commit**

```bash
git add skills/story-init/SKILL.md
git commit -m "feat: add story-init skill for project initialization"
```

---

### Task 3: character-management Skill - References

**Files:**
- Create: `skills/character-management/references/character-template.md`
- Create: `skills/character-management/references/relationship-types.md`

**Step 1: Write character-template.md**

Create `skills/character-management/references/character-template.md`:

````markdown
# Character Template

Use this template when creating a new character file at `characters/{character-name-kebab}.md`.

```yaml
---
name: "{Full Name}"
role: {protagonist|antagonist|supporting|minor}
age: {age}
status: {alive|deceased|unknown}
aliases:
  - "{Alias 1}"
relationships:
  - character: {other-character-kebab}
    type: {relationship-type}
tags:
  - {tag-1}
  - {tag-2}
arc: {character-arc-theme}
---
```

## Appearance

Physical description: build, height, distinguishing features, typical clothing, how they carry themselves.

## Personality & Traits

Core personality traits, temperament, habits, quirks. What makes them memorable in a scene.

## Backstory

Key events that shaped who they are. Only include what's relevant to the story.

## Motivations & Goals

What drives them. What they want (external goal) and what they need (internal goal). How these conflict.

## Voice & Speech Patterns

How they talk: vocabulary level, sentence length, verbal tics, dialect, tone. Include 2-3 example lines of dialogue that capture their voice.

Example:
> "I didn't come here to make friends. I came here because someone has to clean up this mess."

## Character Arc

- **Starting state:** Where they begin emotionally/psychologically
- **Key turning points:** What changes them
- **Ending state:** Where they end up (or projected end)

## Timeline

Key life events in chronological order:

| When | Event | Relevance |
|------|-------|-----------|
| | | |
````

**Step 2: Write relationship-types.md**

Create `skills/character-management/references/relationship-types.md`:

```markdown
# Relationship Types Reference

Use these types in character frontmatter `relationships[].type` field.

## Family

| Type | Description |
|------|-------------|
| parent | Parent of the other character |
| child | Child of the other character |
| sibling | Brother or sister |
| spouse | Married partner |
| partner | Unmarried romantic partner |
| grandparent | Grandparent of the other character |
| grandchild | Grandchild of the other character |
| uncle | Uncle of the other character |
| aunt | Aunt of the other character |
| cousin | Cousin |
| in-law | Related by marriage (specify in notes) |

## Social

| Type | Description |
|------|-------------|
| friend | Close friend |
| ally | Allied but not necessarily close |
| rival | Competitive relationship |
| enemy | Hostile opposition |
| mentor | Teacher/guide figure |
| student | Learner/protege |
| employer | Boss or authority figure |
| subordinate | Works under the other character |
| colleague | Works alongside |

## Story Role

| Type | Description |
|------|-------------|
| protagonist | Main character in opposition or partnership |
| antagonist | Primary opposition to this character |
| love-interest | Romantic interest |
| foil | Character who contrasts/highlights traits |
| confidant | Character they confide in |

## Usage

Relationships are bidirectional. When adding a relationship to one character, add the inverse to the other:

- If A has `type: parent` to B, then B has `type: child` to A
- If A has `type: mentor` to B, then B has `type: student` to A
- If A has `type: rival` to B, then B has `type: rival` to A (symmetric)

Inverse pairs:
- parent <-> child
- grandparent <-> grandchild
- uncle/aunt <-> nephew/niece
- mentor <-> student
- employer <-> subordinate

Symmetric types (same both ways):
- sibling, spouse, partner, friend, ally, rival, enemy, cousin, colleague, foil
```

**Step 3: Commit**

```bash
git add skills/character-management/references/
git commit -m "feat: add character template and relationship types references"
```

---

### Task 4: character-management Skill - SKILL.md

**Files:**
- Create: `skills/character-management/SKILL.md`

**Step 1: Write SKILL.md**

Create `skills/character-management/SKILL.md`:

````markdown
---
name: character-management
description: This skill should be used when the user asks to "create a character", "update a character", "add a character", "build a family tree", "character relationships", "character timeline", "character arc", "character profile", or needs to manage characters in a story project.
---

# Character Management

## Overview

Create and manage rich character profiles for a story project. Each character is a markdown file with YAML frontmatter in the `characters/` directory. Characters are cross-referenced with other story elements through kebab-case identifiers.

## Prerequisites

A story project must already exist (created via the story-init skill). Verify by checking for `story.md` in the project root.

## Creating a Character

1. Read `story.md` for genre, themes, and tone context
2. Read `characters/_index.md` for existing characters
3. Ask for the character's name and role (protagonist, antagonist, supporting, minor)
4. Build the profile through conversation, exploring:
   - Appearance and distinguishing features
   - Personality, traits, and quirks
   - Backstory and formative events
   - Motivations (external wants vs internal needs)
   - Voice and speech patterns (ask for example dialogue)
   - Character arc (starting state, turning points, ending state)
   - Key life events for the timeline
5. Write the character file using the template in `references/character-template.md`
6. Save to `characters/{name-kebab}.md`
7. Update `characters/_index.md` registry table
8. If relationships reference existing characters, update those character files too

## Updating a Character

1. Read the existing character file
2. Read `characters/_index.md` for context on other characters
3. Make the requested changes
4. If relationships changed, update the other character's file (bidirectional)
5. Update `characters/_index.md` if role or status changed

## Managing Relationships

Reference `references/relationship-types.md` for the full list of relationship types and inverse pairs.

When adding a relationship:
- Add the relationship entry to the character's frontmatter
- Add the inverse relationship to the other character's frontmatter
- Update the Relationship Map section in `characters/_index.md`

## Family Trees

Family trees are maintained in the `characters/_index.md` under the "Family Trees" section. Format:

```markdown
## Family Trees

### {Family Name}
- **{Character Name}** ({status}) - [{name-kebab}.md]
  - **{Child Name}** - [{name-kebab}.md]
  - **{Child Name}** - [{name-kebab}.md]
```

Indent children under parents. Note marriages/partnerships inline.

## Cross-Referencing

- When a character is referenced in worldbuilding (e.g., a location's `notable-characters`), ensure the link exists both ways
- When a character appears in a plot arc, ensure they're listed in the arc's `characters` frontmatter
- Character tags should be consistent across the project (e.g., if `magic-user` is used, always use that exact tag)

## Reference Files

- **`references/character-template.md`** - Full blank template for character profiles
- **`references/relationship-types.md`** - Complete relationship type reference with inverse pairs
````

**Step 2: Commit**

```bash
git add skills/character-management/SKILL.md
git commit -m "feat: add character-management skill"
```

---

### Task 5: worldbuilding Skill - References

**Files:**
- Create: `skills/worldbuilding/references/location-template.md`
- Create: `skills/worldbuilding/references/system-template.md`
- Create: `skills/worldbuilding/references/world-element-types.md`

**Step 1: Write location-template.md**

Create `skills/worldbuilding/references/location-template.md`:

````markdown
# Location Template

Use this template when creating a new location file at `worldbuilding/locations/{location-name-kebab}.md`.

```yaml
---
name: "{Location Name}"
type: {city|town|village|fortress|ruins|wilderness|landmark|region|continent|building|other}
region: "{Parent Region}"
population: {number or estimate}
controlled-by: {character-kebab or faction}
notable-characters:
  - {character-kebab}
tags:
  - {tag-1}
  - {tag-2}
status: {thriving|declining|abandoned|contested|hidden}
---
```

## Description

What the location looks, sounds, smells, and feels like. First impressions for someone arriving. Key sensory details that make it distinct.

## History

How the location came to be and key events that happened here. Only include history relevant to the story.

## Culture & Customs

The people who live here, their way of life, traditions, social norms. What makes this place culturally distinct.

## Notable Features

Specific landmarks, buildings, natural features, or points of interest within the location. Things characters would interact with.

## Current State

What the location is like at the time of the story. Political situation, recent events, tensions, opportunities.
````

**Step 2: Write system-template.md**

Create `skills/worldbuilding/references/system-template.md`:

````markdown
# System Template

Use this template when creating a new system file at `worldbuilding/systems/{system-name-kebab}.md`. Systems represent structured aspects of the world: magic, politics, technology, religion, economy, etc.

```yaml
---
name: "{System Name}"
type: {magic|political|technology|religion|economic|military|social|education|other}
prevalence: {universal|common|uncommon|rare|secret}
---
```

## Overview

What this system is and its role in the world. One paragraph summary.

## Rules & Limitations

How the system works. What it can and cannot do. Costs, constraints, and consequences. Be specific - well-defined limitations make systems compelling.

## History

How the system developed or was discovered. Key historical moments that shaped its current form.

## Practitioners

Who uses or participates in this system. Social status, requirements, training, organizations.

## Impact on Society

How this system shapes daily life, culture, politics, and conflict in the world. Ripple effects.
````

**Step 3: Write world-element-types.md**

Create `skills/worldbuilding/references/world-element-types.md`:

```markdown
# World Element Types Reference

When building a world element, use these prompts to ensure thorough coverage for each type.

## Magic System

Key questions to address:
- What is the source of magic? (innate, learned, divine, natural, artifact-based)
- Who can use it? (everyone, select few, specific bloodlines, trained practitioners)
- What does it cost? (energy, health, materials, sanity, lifespan)
- What are the hard limits? (cannot raise dead, cannot create matter, etc.)
- How is it perceived socially? (revered, feared, regulated, mundane)
- What are the categories/schools/disciplines?

## Political System

Key questions to address:
- What is the power structure? (monarchy, democracy, oligarchy, theocracy, tribal)
- How is power transferred? (hereditary, elected, conquered, appointed)
- What factions exist and what do they want?
- What laws matter to the story?
- What is the relationship between regions/nations?
- What tensions or conflicts exist?

## Technology System

Key questions to address:
- What is the general technology level? (stone age, medieval, industrial, modern, futuristic)
- What technologies are unusually advanced or absent?
- How does technology interact with other systems (e.g., magic)?
- Who controls key technologies?
- What are the societal impacts of key technologies?

## Religion System

Key questions to address:
- What deities or spiritual forces exist? (real or believed)
- What are the major religious institutions?
- How does religion interact with political power?
- What rituals, holidays, or practices matter to the story?
- Are there religious conflicts or schisms?

## Economic System

Key questions to address:
- What is the currency and trade system?
- What are the major industries and resources?
- What is the wealth distribution?
- What economic tensions drive conflict?
- How does the economy interact with other systems?

## Military System

Key questions to address:
- How are armed forces organized?
- What weapons, tactics, and strategies are used?
- What is the relationship between military and political power?
- What recent or ongoing conflicts exist?
- How does military service affect social standing?

## Social System

Key questions to address:
- What are the social classes or castes?
- How is social mobility achieved (or prevented)?
- What are the gender roles and family structures?
- What cultural values dominate?
- What social tensions exist?
```

**Step 4: Commit**

```bash
git add skills/worldbuilding/references/
git commit -m "feat: add worldbuilding reference templates"
```

---

### Task 6: worldbuilding Skill - SKILL.md

**Files:**
- Create: `skills/worldbuilding/SKILL.md`

**Step 1: Write SKILL.md**

Create `skills/worldbuilding/SKILL.md`:

````markdown
---
name: worldbuilding
description: This skill should be used when the user asks to "create a location", "add a location", "magic system", "political system", "build the world", "add culture", "world history", "technology system", "religion", "economy", or wants to develop any aspect of a story's world and setting.
---

# Worldbuilding

## Overview

Create and manage world elements for a story project. Locations and systems (magic, politics, technology, etc.) are stored as markdown files in the `worldbuilding/` directory with YAML frontmatter. All elements cross-reference characters and other story elements.

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
8. If notable characters are listed, verify those character files exist and add location references to them

## Creating a System

1. Read `story.md` for genre and themes context
2. Read `worldbuilding/_index.md` for existing systems
3. Identify the system type and consult `references/world-element-types.md` for the relevant prompts
4. Build the system through conversation, addressing the key questions for that type
5. Write the file using `references/system-template.md`
6. Save to `worldbuilding/systems/{name-kebab}.md`
7. Update `worldbuilding/_index.md` systems table
8. Cross-reference with characters who interact with the system (e.g., magic-users for a magic system)

## Updating World Elements

1. Read the existing file
2. Make the requested changes
3. If cross-references changed, update the linked files
4. Update `worldbuilding/_index.md` if name, type, or status changed

## Cross-Referencing

- Locations reference characters via `notable-characters` in frontmatter
- Systems reference practitioners via character tags
- When a location is used in a chapter, the chapter's frontmatter `locations` field links back
- Keep the `worldbuilding/_index.md` world overview section current as elements are added

## Reference Files

- **`references/location-template.md`** - Template for location files
- **`references/system-template.md`** - Template for system files
- **`references/world-element-types.md`** - Detailed prompts for each system type (magic, political, technology, religion, economic, military, social)
````

**Step 2: Commit**

```bash
git add skills/worldbuilding/SKILL.md
git commit -m "feat: add worldbuilding skill"
```

---

### Task 7: plot-structure Skill - References

**Files:**
- Create: `skills/plot-structure/references/arc-template.md`
- Create: `skills/plot-structure/references/structure-models.md`

**Step 1: Write arc-template.md**

Create `skills/plot-structure/references/arc-template.md`:

````markdown
# Arc Template

Use this template when creating a new arc file at `plot/arcs/{arc-name-kebab}.md`.

```yaml
---
name: "{Arc Name}"
type: {main|subplot|character|thematic}
status: {planned|in-progress|resolved}
characters:
  - {character-kebab}
themes:
  - {theme}
acts:
  - {act-1|act-2|act-3}
---
```

## Setup

The initial state of affairs. What's normal before the arc begins. The inciting incident that sets this arc in motion.

## Rising Action

Key escalations, complications, and developments. List in order:

1. {First escalation}
2. {Second escalation}
3. {Complication or reversal}

## Climax

The turning point of this arc. The moment of highest tension where the outcome is decided.

## Resolution

How the arc resolves. What changes as a result. How the world and characters are different.

## Plot Points

Ordered list of specific story events, linked to chapters:

| # | Plot Point | Chapter | Notes |
|---|-----------|---------|-------|
| 1 | | | |

## Foreshadowing

Track what's planted and where it pays off:

| Planted | Payoff | Chapter Planted | Chapter Payoff | Status |
|---------|--------|-----------------|----------------|--------|
| | | | | {planted\|paid-off} |
````

**Step 2: Write structure-models.md**

Create `skills/plot-structure/references/structure-models.md`:

```markdown
# Story Structure Models Reference

Common story structures with beat sheets. Use as starting points - adapt to fit the story.

## Three-Act Structure

The most common Western story structure.

| Beat | Act | Description |
|------|-----|-------------|
| Opening | 1 | Establish normal world and protagonist |
| Inciting Incident | 1 | Event that disrupts the status quo |
| First Plot Point | 1 | Protagonist commits to the journey (end of Act 1, ~25%) |
| Rising Action | 2 | Protagonist faces escalating obstacles |
| Midpoint | 2 | Major reversal or revelation (~50%) |
| Crisis | 2 | Stakes raised, things get worse |
| Second Plot Point | 2 | Final push, all seems lost (end of Act 2, ~75%) |
| Climax | 3 | Final confrontation, highest tension |
| Resolution | 3 | New normal established, loose ends tied |

## Hero's Journey (Campbell/Vogler)

Mythic structure common in fantasy and adventure.

| Beat | Phase | Description |
|------|-------|-------------|
| Ordinary World | Departure | Hero's normal life |
| Call to Adventure | Departure | Challenge or opportunity appears |
| Refusal of the Call | Departure | Hero hesitates or resists |
| Meeting the Mentor | Departure | Guide appears with wisdom or tools |
| Crossing the Threshold | Departure | Hero enters the unfamiliar world |
| Tests, Allies, Enemies | Initiation | Hero learns the rules, makes friends and foes |
| Approach to the Inmost Cave | Initiation | Preparation for the central ordeal |
| The Ordeal | Initiation | Major crisis, death and rebirth moment |
| Reward | Initiation | Hero gains what they sought |
| The Road Back | Return | Journey home, pursued by consequences |
| Resurrection | Return | Final test, transformation complete |
| Return with the Elixir | Return | Hero returns changed, bearing gifts |

## Save the Cat (Snyder)

Popular in screenwriting, works well for tightly paced stories.

| Beat | Position | Description |
|------|----------|-------------|
| Opening Image | 1% | Visual/thematic snapshot of starting state |
| Theme Stated | 5% | Theme hinted at in dialogue |
| Set-Up | 1-10% | Establish world, characters, stakes |
| Catalyst | 10% | The event that changes everything |
| Debate | 10-20% | Protagonist wrestles with the call |
| Break into Two | 20% | Protagonist chooses to act |
| B Story | 22% | Secondary story begins (often love interest) |
| Fun and Games | 20-50% | The "promise of the premise" delivered |
| Midpoint | 50% | False victory or false defeat |
| Bad Guys Close In | 50-75% | Opposition intensifies |
| All Is Lost | 75% | Lowest point, whiff of death |
| Dark Night of the Soul | 75-80% | Protagonist processes the loss |
| Break into Three | 80% | Solution discovered, often from B story |
| Finale | 80-99% | Protagonist acts, defeats opposition |
| Final Image | 99% | Visual/thematic proof of change |

## Kishotenketsu

Four-act structure common in East Asian storytelling. No central conflict required.

| Beat | Act | Description |
|------|-----|-------------|
| Ki (Introduction) | 1 | Establish characters and setting |
| Sho (Development) | 2 | Develop the story, deepen understanding |
| Ten (Twist) | 3 | Unexpected element, shift in perspective |
| Ketsu (Conclusion) | 4 | Reconcile the twist with the established story |

## Five-Act Structure (Shakespeare)

Classical dramatic structure.

| Beat | Act | Description |
|------|-----|-------------|
| Exposition | 1 | Setting, characters, initial conflict |
| Rising Action | 2 | Complications develop, tension builds |
| Climax | 3 | Turning point, peak of tension |
| Falling Action | 4 | Consequences unfold, momentum shifts |
| Denouement | 5 | Resolution and new equilibrium |

## Choosing a Structure

- **Three-Act:** Default choice for most stories. Simple, flexible, well-understood.
- **Hero's Journey:** Fantasy, adventure, coming-of-age. Stories about transformation.
- **Save the Cat:** Tightly paced commercial fiction. Stories that need precise pacing.
- **Kishotenketsu:** Literary fiction, slice-of-life, stories exploring ideas over conflict.
- **Five-Act:** Epic scope, multiple climaxes, complex political drama.

Structures are guides, not rules. Mix and adapt as the story demands.
```

**Step 3: Commit**

```bash
git add skills/plot-structure/references/
git commit -m "feat: add plot structure reference templates"
```

---

### Task 8: plot-structure Skill - SKILL.md

**Files:**
- Create: `skills/plot-structure/SKILL.md`

**Step 1: Write SKILL.md**

Create `skills/plot-structure/SKILL.md`:

````markdown
---
name: plot-structure
description: This skill should be used when the user asks to "create a plot arc", "story structure", "add a plot point", "story timeline", "track foreshadowing", "pacing", "act structure", "story arc", "plot outline", or wants to plan and manage the narrative structure of a story.
---

# Plot Structure

## Overview

Plan and manage story arcs, plot points, foreshadowing, and narrative timeline. Each arc is a markdown file in `plot/arcs/` with a chronological timeline maintained in `plot/timeline.md`. The plot index tracks all arcs, their status, and theme coverage.

## Prerequisites

A story project must already exist (created via the story-init skill). Verify by checking for `story.md` in the project root.

## Choosing a Story Structure

1. Read `story.md` for genre and themes
2. Consult `references/structure-models.md` for available structures
3. Recommend a structure based on genre (default to three-act if unclear)
4. Update `plot/_index.md` frontmatter `structure` field
5. Populate the story structure section with the beat sheet

## Creating an Arc

1. Read `story.md` for themes
2. Read `plot/_index.md` for existing arcs
3. Read `characters/_index.md` to understand available characters
4. Ask for:
   - Arc name
   - Type (main, subplot, character, thematic)
   - Which characters are involved
   - Which themes it serves
5. Build the arc through conversation: setup, escalations, climax, resolution
6. Write the file using `references/arc-template.md`
7. Save to `plot/arcs/{arc-name-kebab}.md`
8. Update `plot/_index.md` arcs table
9. Update theme tracking in `plot/_index.md`
10. If characters are referenced, verify they exist in `characters/`

## Managing Plot Points

Plot points live within arc files in the "Plot Points" table. When adding a plot point:

1. Read the relevant arc file
2. Add the plot point to the table with chapter reference (if known)
3. Add the event to `plot/timeline.md` in chronological order
4. If the plot point involves foreshadowing, add it to the arc's foreshadowing table

## Timeline Management

The timeline at `plot/timeline.md` is a chronological master list of all story events across all arcs.

When adding events:
- Insert in chronological order
- Link to the relevant arc and chapter
- Keep entries concise (one line per event)

When reviewing the timeline:
- Check for chronological consistency
- Identify pacing issues (too many events clustered, long gaps)
- Flag arcs that haven't progressed

## Foreshadowing Tracking

Each arc tracks its own foreshadowing in the "Foreshadowing" table:
- **Planted:** What hint or setup is placed
- **Payoff:** What the payoff will be
- **Chapter Planted / Chapter Payoff:** Where each occurs
- **Status:** `planted` or `paid-off`

During chapter writing, flag any `planted` items that haven't been paid off as reminders.

## Cross-Referencing

- Arcs reference characters via frontmatter `characters` field
- Arcs reference themes via frontmatter `themes` field
- Plot points reference chapters
- Timeline entries link arcs and chapters
- Theme tracking in `plot/_index.md` maps themes to arcs and chapters

## Reference Files

- **`references/arc-template.md`** - Template for arc files with frontmatter and sections
- **`references/structure-models.md`** - Story structure models (three-act, hero's journey, save the cat, kishotenketsu, five-act) with beat sheets
````

**Step 2: Commit**

```bash
git add skills/plot-structure/SKILL.md
git commit -m "feat: add plot-structure skill"
```

---

### Task 9: chapter-writing Skill - References

**Files:**
- Create: `skills/chapter-writing/references/chapter-template.md`
- Create: `skills/chapter-writing/references/writing-guidelines.md`

**Step 1: Write chapter-template.md**

Create `skills/chapter-writing/references/chapter-template.md`:

````markdown
# Chapter Template

Use this template when creating a new chapter file at `chapters/chapter-{NN}.md`.

```yaml
---
title: "{Chapter Title}"
number: {N}
pov: {character-kebab}
locations:
  - {location-kebab}
characters:
  - {character-kebab}
arcs-advanced:
  - {arc-kebab}
status: {outline|draft|revised|final}
word-count: {N}
---
```

## Outline

*Beat-by-beat outline approved before writing:*

1. {Beat 1 - what happens, what it accomplishes}
2. {Beat 2}
3. {Beat 3}
...

**Arc beats advanced:** {Which plot points this chapter hits}
**Foreshadowing planted:** {Any setups placed}
**Foreshadowing paid off:** {Any earlier setups resolved}

---

## Chapter Text

{Full prose goes here}
````

**Step 2: Write writing-guidelines.md**

Create `skills/chapter-writing/references/writing-guidelines.md`:

```markdown
# Writing Guidelines

Guidelines for writing chapter prose. Adapt to the story's genre, tone, and POV as defined in `story.md`.

## Show, Don't Tell

- Convey emotion through action, dialogue, and sensory detail rather than stating feelings
- BAD: "She was angry."
- GOOD: "Her fingers whitened around the hilt. She spoke through her teeth."

## POV Consistency

- **First person:** Everything filtered through narrator's voice, knowledge, and bias
- **Third-person limited:** Stay in one character's head per scene. Only describe what they perceive, think, and feel
- **Third-person omniscient:** Can reveal any character's thoughts, but maintain a consistent narrative voice

Do NOT shift POV mid-scene. If a POV shift is needed, use a scene break (marked with `---`).

## Dialogue

- Dialogue should reveal character, advance plot, or both
- Each character should have a distinct voice (reference their Voice & Speech Patterns)
- Use dialogue tags sparingly - "said" is invisible, fancy tags distract
- Break up long speeches with action beats
- Avoid exposition dumps disguised as conversation

## Pacing

- Short sentences and paragraphs = fast pace, tension, action
- Longer sentences and paragraphs = slower pace, reflection, atmosphere
- Vary sentence length for rhythm
- Scene length should match importance - don't over-write minor moments

## Scene Structure

Each scene should have:
- **Goal:** What the POV character wants in this scene
- **Conflict:** What opposes them
- **Outcome:** What happens (often a setback that drives the next scene)

Not every scene needs explosive conflict - quiet character moments matter too. But every scene should change something.

## Sensory Detail

Ground scenes in the physical world:
- Sight, sound, smell, touch, taste
- Choose 2-3 senses per scene, not all five
- Use details specific to the location (reference the location file)
- Sensory details should reflect the POV character's state of mind

## Chapter Openings

- Orient the reader quickly: who, where, when
- Hook with tension, mystery, or voice
- Avoid opening with weather or waking up (unless deliberately subverting the cliché)

## Chapter Endings

- End on a moment of change, revelation, or tension
- Cliffhangers work for action chapters
- Quiet resonance works for character chapters
- The last line should make the reader want to continue

## Continuity

Before writing, check:
- Previous chapter's ending (pick up threads, don't contradict)
- Character states (injuries, emotional state, knowledge)
- Timeline consistency (time of day, travel times, seasons)
- Plot arc progress (what beats need to land)
```

**Step 3: Commit**

```bash
git add skills/chapter-writing/references/
git commit -m "feat: add chapter writing reference templates"
```

---

### Task 10: chapter-writing Skill - SKILL.md

**Files:**
- Create: `skills/chapter-writing/SKILL.md`

**Step 1: Write SKILL.md**

Create `skills/chapter-writing/SKILL.md`:

````markdown
---
name: chapter-writing
description: This skill should be used when the user asks to "write a chapter", "next chapter", "chapter outline", "draft chapter", "continue the story", "write a scene", "outline a chapter", or wants to write prose for a story project.
---

# Chapter Writing

## Overview

Write story chapters using an outline-first workflow. Gathers context from all other story elements (characters, world, plot) to maintain consistency, builds a beat-by-beat outline for approval, then writes full prose. After writing, updates all cross-references (chapter index, timeline, foreshadowing).

## Prerequisites

A story project must already exist with at least:
- `story.md` (story bible)
- At least one character in `characters/`
- A plot structure in `plot/_index.md` (recommended but not required for first chapters)

## Outline-First Workflow

### 1. Gather Context

Read these files to understand the current story state:

- `story.md` - genre, themes, POV, tense
- `chapters/_index.md` - what's been written, current word count
- `plot/_index.md` - arc status, what needs to happen next
- `plot/timeline.md` - chronological position

If this isn't the first chapter, also read:
- The previous chapter file - for continuity (ending state, cliffhangers, emotional tone)
- Active arc files in `plot/arcs/` - for upcoming plot beats

### 2. Determine Chapter Scope

Ask the user:
- What should this chapter cover? (or suggest based on plot arcs)
- Whose POV?
- Which location(s)?

If plot arcs exist, suggest the next logical beats to advance.

### 3. Build the Outline

Create a beat-by-beat outline listing:
- Each scene/beat and what it accomplishes
- POV character and location for each beat
- Which arc plot points are advanced
- Any foreshadowing to plant or pay off

Load the POV character's file for voice reference. Load relevant location files for setting details.

Present the outline to the user for approval. Revise until approved.

### 4. Write the Chapter

With the approved outline, write the full prose:

- Follow the POV and tense from `story.md`
- Use the POV character's voice and speech patterns from their profile
- Ground scenes in location details from worldbuilding files
- Consult `references/writing-guidelines.md` for prose craft guidance
- Use the chapter template from `references/chapter-template.md`
- Include the approved outline in the file above the prose (for reference)

Save to `chapters/chapter-{NN}.md` with appropriate frontmatter.

### 5. Post-Write Updates

After the chapter is written:

1. **Update `chapters/_index.md`** - add chapter to registry, update total word count
2. **Update `plot/timeline.md`** - add events from this chapter in chronological order
3. **Update arc files** - mark advanced plot points with chapter reference
4. **Update foreshadowing** - mark any items as `planted` or `paid-off` with chapter reference
5. **Note character changes** - if a character's status changed (injury, revelation, relationship shift), flag for the user to update the character file

Present a summary of all updates made.

## Scene Breaks

Within a chapter, separate scenes with `---`. Each scene should have a clear POV character (even if the same as the previous scene) and location.

## Revision Workflow

When asked to revise a chapter:
1. Read the existing chapter
2. Understand what needs to change
3. Make targeted edits rather than rewriting from scratch
4. Update word count in frontmatter
5. Update chapter status (draft -> revised)

## Reference Files

- **`references/chapter-template.md`** - Frontmatter and structure template for chapter files
- **`references/writing-guidelines.md`** - Prose craft guidance: show-don't-tell, POV, dialogue, pacing, scene structure, continuity
````

**Step 2: Commit**

```bash
git add skills/chapter-writing/SKILL.md
git commit -m "feat: add chapter-writing skill"
```

---

### Task 11: Final Validation

**Step 1: Verify all files exist**

```bash
find . -name "*.md" -o -name "*.json" | sort
```

Expected output:
```
./.claude-plugin/plugin.json
./docs/plans/2026-02-12-story-skills-design.md
./docs/plans/2026-02-12-story-skills-implementation.md
./skills/chapter-writing/references/chapter-template.md
./skills/chapter-writing/references/writing-guidelines.md
./skills/chapter-writing/SKILL.md
./skills/character-management/references/character-template.md
./skills/character-management/references/relationship-types.md
./skills/character-management/SKILL.md
./skills/plot-structure/references/arc-template.md
./skills/plot-structure/references/structure-models.md
./skills/plot-structure/SKILL.md
./skills/story-init/SKILL.md
./skills/worldbuilding/references/location-template.md
./skills/worldbuilding/references/system-template.md
./skills/worldbuilding/references/world-element-types.md
./skills/worldbuilding/SKILL.md
```

**Step 2: Verify plugin.json is valid JSON**

```bash
python3 -c "import json; json.load(open('.claude-plugin/plugin.json')); print('Valid JSON')"
```

**Step 3: Verify all SKILL.md files have valid frontmatter**

Check each SKILL.md starts with `---` and has `name` and `description` fields.

**Step 4: Commit implementation plan**

```bash
git add docs/plans/2026-02-12-story-skills-implementation.md
git commit -m "docs: add implementation plan"
```

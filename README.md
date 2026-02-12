# Story Skills

A Claude Code plugin for end-to-end story writing powered by markdown. Manage characters, build worlds, structure plots, and write chapters — all as structured markdown files with YAML frontmatter.

## Installation

```shell
# Add the marketplace
/plugin marketplace add danjdewhurst/story-skills

# Install the plugin
/plugin install story-skills@story-skills
```

## Skills

### story-init

Scaffolds a new story project with a complete folder structure:

```
my-story/
├── story.md              # Story bible (title, genre, themes, POV, tense)
├── characters/
│   └── _index.md         # Character registry
├── worldbuilding/
│   ├── _index.md         # World overview
│   ├── locations/
│   └── systems/
├── plot/
│   ├── _index.md         # Arc overview
│   ├── arcs/
│   └── timeline.md
└── chapters/
    └── _index.md         # Chapter registry
```

**Try:** "Start a new story" or "Create a story project"

### character-management

Create rich character profiles with structured frontmatter for relationships, traits, and arcs. Manages family trees, bidirectional relationships, and character timelines.

**Try:** "Create a character" or "Build a family tree"

### worldbuilding

Build locations and world systems (magic, politics, technology, religion, economy, military, social, education). Each element gets its own file with cross-references to characters and other world elements.

**Try:** "Create a location" or "Design a magic system"

### plot-structure

Plan story arcs using established structures (three-act, hero's journey, save the cat, kishotenketsu). Track plot points, timelines, and foreshadowing across arcs and chapters.

**Try:** "Create a plot arc" or "Set up the story structure"

### chapter-writing

Write chapters using an outline-first workflow. Gathers context from all other story files to maintain consistency — character voices, location details, arc beats, and timeline continuity.

**Try:** "Write a chapter" or "Outline the next chapter"

## Example

See [`examples/the-last-ember/`](examples/the-last-ember/) for a complete sample story project showing what the plugin produces — a fantasy story with three characters, two locations, a magic system, a plot arc with foreshadowing tracking, and a first chapter with full prose.

## How It Works

Every story element is a markdown file with YAML frontmatter. Skills cross-reference each other:

- `story.md` is the top-level bible read by all skills
- Characters, locations, and arcs use kebab-case identifiers (e.g., `sera-voss`)
- `_index.md` files serve as registries for each domain
- Relationships and references are maintained bidirectionally

## Using Without Claude Code

The plugin system is Claude Code specific, but the skills themselves are just markdown — they work anywhere:

- **Claude.ai Projects** — add the SKILL.md and reference files as project knowledge
- **Claude API** — include skill content in system prompts
- **Other LLMs** — the templates, workflows, and story structure are model-agnostic

The automatic skill loading ("say 'create a character' and the right skill activates") only works in Claude Code. Everywhere else, you'd paste the relevant SKILL.md content into your conversation manually.

## License

MIT

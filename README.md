# Story Skills

A Claude Code plugin for end-to-end story writing powered by markdown. Manage characters, build worlds, structure plots, and write chapters — all as structured markdown files with YAML frontmatter.

## Installation

### Claude Code

```shell
# Add the marketplace
/plugin marketplace add danjdewhurst/story-skills

# Install the plugin
/plugin install story-skills@story-skills
```

### OpenCode

The skills use the same `SKILL.md` format that [OpenCode](https://opencode.ai) supports natively. Copy the skill folders into your skills directory:

```shell
# Clone the repo
git clone https://github.com/danjdewhurst/story-skills.git

# Copy skills to your project
cp -r story-skills/skills/* .opencode/skills/

# Or install globally
cp -r story-skills/skills/* ~/.config/opencode/skills/
```

OpenCode also searches `.claude/skills/` paths, so project-level Claude skills are automatically discovered.

### Gemini CLI

[Gemini CLI](https://github.com/google-gemini/gemini-cli) supports the same `SKILL.md` format via the [Agent Skills](https://agentskills.io) standard. Install directly from the repo:

```shell
# Install all skills globally
gemini skills install https://github.com/danjdewhurst/story-skills.git

# Or install a specific skill
gemini skills install https://github.com/danjdewhurst/story-skills.git --path skills/story-init
gemini skills install https://github.com/danjdewhurst/story-skills.git --path skills/character-management
gemini skills install https://github.com/danjdewhurst/story-skills.git --path skills/worldbuilding
gemini skills install https://github.com/danjdewhurst/story-skills.git --path skills/plot-structure
gemini skills install https://github.com/danjdewhurst/story-skills.git --path skills/chapter-writing

# Or link locally after cloning
git clone https://github.com/danjdewhurst/story-skills.git
gemini skills link story-skills/skills
```

Gemini will auto-discover the skills and activate them when your request matches a skill's description.

### Codex (OpenAI)

[Codex](https://github.com/openai/codex) uses the same `SKILL.md` format via the [Agent Skills](https://agentskills.io) standard. Copy the skill folders to any of Codex's discovery locations:

```shell
# Clone the repo
git clone https://github.com/danjdewhurst/story-skills.git

# Install to your user skills (available across all projects)
cp -r story-skills/skills/* ~/.agents/skills/

# Or install to a specific repo
cp -r story-skills/skills/* .agents/skills/
```

You can also use the built-in installer or symlink the skills directory. Codex detects new skills automatically.

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

## Other Platforms

The skills are just markdown files with YAML frontmatter — they work beyond Claude Code and OpenCode:

- **Claude.ai Projects** — add the SKILL.md and reference files as project knowledge
- **Claude API** — include skill content in system prompts
- **Any SKILL.md-compatible agent** — the format is becoming a standard; copy the skill folders to your agent's skills directory
- **Other LLMs** — the templates, workflows, and story structure are model-agnostic; paste the relevant SKILL.md content into your conversation

## License

MIT

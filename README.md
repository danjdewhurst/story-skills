<div align="center">

# ✨ Story Skills

**Agent Skills for planning, tracking, and drafting fiction in markdown.**

Story Skills gives agents a shared project format for fiction: a story bible, character files, worldbuilding notes, factions, artifacts, plot arcs, scene state, continuity questions, promises/payoffs, timelines, and chapter drafts. Everything is plain markdown with YAML frontmatter, packaged as standard Agent Skills with Codex and Claude Code plugin support.

The companion CLI treats the story bible as a checkable contract: a **continuity engine** catches dead characters walking, payoffs that land before their setup, unfired Chekhov guns, and stale story state — deterministically, before a reader ever could.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Agent Skills](https://img.shields.io/badge/Agent_Skills-SKILL.md-blue)](https://agentskills.io)
[![Codex](https://img.shields.io/badge/Codex-plugin-10A37F)](https://developers.openai.com/codex)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)

</div>

---

> Built on the open **Agent Skills** standard. Install it as a **Codex** or **Claude Code** plugin, with the Agent Skills CLI, or copy the `skills/` folders into any agent that supports `SKILL.md`.

## 🚀 Quick Start

```shell
# Codex plugin
codex plugin marketplace add danjdewhurst/story-skills
codex plugin add story-skills@story-skills

# Claude Code plugin
/plugin marketplace add danjdewhurst/story-skills
/plugin install story-skills@story-skills
```

For compatible `SKILL.md` agents, you can also install the bundle with the Agent Skills CLI:

```shell
npx skills add danjdewhurst/story-skills

# Or with Bun
bunx skills add danjdewhurst/story-skills
```

Then ask **"Start a new story"** to scaffold the project.

## 🔎 The Continuity Engine

Long-range consistency is the thing language models are worst at and prompts cannot fix. Story Skills makes it deterministic: character deaths, promises/payoffs, open questions, scene casts, and durable knowledge/object state live in frontmatter, and `story continuity` treats contradictions like a compiler treats type errors.

[`examples/the-unraveled-thread/`](examples/the-unraveled-thread/) is a deliberately broken mystery. It passes `story validate` and `story links` cleanly — every file is well-formed — but the story itself doesn't hold together:

```text
$ story continuity examples/the-unraveled-thread
Continuity check failed: 4 errors, 3 warnings
error: chapters/chapter-04.md lists edran-vale, who died in chapter-02; move posthumous appearances to mentions
error: continuity/promises/the-broken-compass.md pays off in chapter-02 before it is planted in chapter-03
error: continuity/questions/who-burned-the-mill.md resolves in chapter-02 before it is introduced in chapter-03
error: continuity/state.md knowledge-state[0] references missing chapter chapter-05
warning: chapters/chapter-03.md POV character nessa-thorn is not listed in characters
warning: continuity/promises/the-sealed-letter.md was planted in chapter-01, 3 chapters ago, and has no payoff yet
warning: continuity/state.md object-state[0] status active conflicts with worldbuilding/artifacts/vales-compass.md status destroyed
```

These findings are exact, file-addressed, and reproducible — CI asserts them on every commit. Intentional flashbacks and posthumous appearances stay legal via the chapter `mentions` field. `story doctor` and `story next` fold the same checks into prioritized repair actions.

## ✍️ Highly Recommended: Better Writing

For stronger chapter drafts and revision passes, install [forjd/better-writing](https://github.com/forjd/better-writing) alongside Story Skills. It adds voice calibration, anti-generic writing checks, and a final prose-quality pass.

```shell
npx skills add forjd/better-writing
```

Or with Bun:

```shell
bunx skills add forjd/better-writing
```

Story Skills works without it, but chapter drafting and revision are better when agents can use `better-writing`.

## 📦 Installation

<details>
<summary><strong>Codex</strong></summary>

```shell
# Add the marketplace
codex plugin marketplace add danjdewhurst/story-skills

# Install the plugin
codex plugin add story-skills@story-skills
```

For local skill authoring without a plugin install:

```shell
git clone https://github.com/danjdewhurst/story-skills.git
cp -r story-skills/skills/* ~/.agents/skills/

# Or install to a specific repo as repo-scoped skills
cp -r story-skills/skills/* .agents/skills/
```

Codex detects repo and user skills automatically. The plugin install is still the recommended path for this bundle.

</details>

<details>
<summary><strong>Claude Code</strong></summary>

```shell
# Add the marketplace
/plugin marketplace add danjdewhurst/story-skills

# Install the plugin
/plugin install story-skills@story-skills
```

</details>

<details>
<summary><strong>GitHub Copilot (VS Code)</strong></summary>

[VS Code with Copilot](https://code.visualstudio.com/docs/copilot/customization/agent-skills) discovers skills from multiple directories:

```shell
git clone https://github.com/danjdewhurst/story-skills.git

# Copy skills to your project (any of these work)
cp -r story-skills/skills/* .github/skills/
cp -r story-skills/skills/* .agents/skills/

# Or install globally
cp -r story-skills/skills/* ~/.copilot/skills/
```

Skills can activate when your request matches a skill description, or you can invoke them manually.

</details>

<details>
<summary><strong>Cursor</strong></summary>

[Cursor](https://www.cursor.com) supports the `SKILL.md` standard:

```shell
git clone https://github.com/danjdewhurst/story-skills.git

cp -r story-skills/skills/* .agents/skills/
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

[Windsurf](https://windsurf.com) discovers skills from workspace and global directories:

```shell
git clone https://github.com/danjdewhurst/story-skills.git

# Copy skills to your project
cp -r story-skills/skills/* .windsurf/skills/

# Or install globally
cp -r story-skills/skills/* ~/.codeium/windsurf/skills/
```

Cascade can invoke a matching skill automatically. You can also use `@skill-name` to invoke one directly.

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

[Gemini CLI](https://github.com/google-gemini/gemini-cli) supports the same `SKILL.md` format via the [Agent Skills](https://agentskills.io) standard:

```shell
# Install all skills globally
gemini skills install https://github.com/danjdewhurst/story-skills.git

# Or install a specific skill
gemini skills install https://github.com/danjdewhurst/story-skills.git --path skills/story-init
gemini skills install https://github.com/danjdewhurst/story-skills.git --path skills/character-management
gemini skills install https://github.com/danjdewhurst/story-skills.git --path skills/worldbuilding
gemini skills install https://github.com/danjdewhurst/story-skills.git --path skills/plot-structure
gemini skills install https://github.com/danjdewhurst/story-skills.git --path skills/chapter-writing
gemini skills install https://github.com/danjdewhurst/story-skills.git --path skills/revision-continuity

# Or link locally after cloning
git clone https://github.com/danjdewhurst/story-skills.git
gemini skills link story-skills/skills
```

Gemini discovers the skills and can activate them when your request matches a skill description.

</details>

<details>
<summary><strong>OpenCode</strong></summary>

The skills use the same `SKILL.md` format that [OpenCode](https://opencode.ai) supports natively:

```shell
git clone https://github.com/danjdewhurst/story-skills.git

# Copy skills to your project
cp -r story-skills/skills/* .opencode/skills/

# Or install globally
cp -r story-skills/skills/* ~/.config/opencode/skills/
```

OpenCode also searches common skill paths such as `.claude/skills/`, so compatible project-level skills can be discovered automatically.

</details>

<details>
<summary><strong>Other platforms</strong></summary>

These skills follow the open [Agent Skills](https://agentskills.io) standard: `SKILL.md` files with YAML frontmatter. If your agent supports the Agent Skills CLI, install the bundle directly:

```shell
npx skills add danjdewhurst/story-skills

# Or with Bun
bunx skills add danjdewhurst/story-skills
```

Use `--skill <name>` to install only specific skills, or `--agent <name>` to target a supported agent. You can also copy the skill folders into any compatible agent's skills directory.

For non-agent use:

- **Claude.ai / ChatGPT Projects** — add the SKILL.md and reference files as project knowledge
- **Any LLM API** — include skill content in system prompts
- **Manual use** — the templates, workflows, and story structure are model-agnostic

</details>

## 🛠️ Skills

| Skill | What it does | Try saying |
|-------|-------------|------------|
| **story-init** | Scaffolds the story bible, folders, and registries | *"Start a new story"* |
| **character-management** | Creates character profiles with relationships, traits, arcs, and family trees | *"Create a character"* |
| **worldbuilding** | Builds locations and systems: magic, politics, technology, religion, and more | *"Design a magic system"* |
| **plot-structure** | Plans arcs with structures like three-act, hero's journey, Save the Cat, and kishotenketsu | *"Create a plot arc"* |
| **chapter-writing** | Drafts chapters through an outline-first workflow that pulls from story context | *"Write the next chapter"* |
| **revision-continuity** | Revises drafts, audits continuity, and keeps character state, timeline, and arc changes consistent | *"Continuity-check chapter 3"* |
| **story-maintenance** | Runs deterministic CLI checks for validation, continuity, reports, indexing, links, word counts, import, and export | *"Validate my story project"* |

For stronger prose, pair **chapter-writing** with [**better-writing**](https://github.com/forjd/better-writing).

## 🧰 Companion CLI

The optional `story` CLI handles deterministic project maintenance while the skills handle the creative workflow.

```shell
bun install
bun run story --help
```

The package also exposes a Node-compatible bin, so published installs can run `story` through npm/npx without Bun-specific runtime APIs. For copied-skill installs, `story-maintenance` includes a bundled `scripts/story.js` fallback that agents can run with Node.

The CLI is for deterministic maintenance only. Agents should write story content directly to markdown files, not create project-local build or generator scripts to emit the story.

| Command | Purpose |
|---------|---------|
| `story init "The Last Ember"` | Scaffold a story project with the standard markdown layout |
| `story add character "Sera Voss"` | Create entity files for characters, locations, systems, factions, artifacts, arcs, chapters, scenes, questions, promises, and glossary terms |
| `story rename character sera-voss "Sera Vale"` | Rename an entity and update kebab-case references |
| `story remove promise old-setup` | Remove an entity and scrub metadata references |
| `story migrate [path]` | Upgrade a project to the current schema |
| `story validate [path]` | Check required files, schema version, YAML frontmatter, registries, and word-count warnings |
| `story reindex [path]` | Rebuild registry tables from the current markdown files |
| `story wordcount [path] --write` | Count chapter prose and update chapter frontmatter plus the chapter registry |
| `story links [path]` | Check character, location, chapter, and arc cross-references/backlinks |
| `story continuity [path]` | Check deterministic continuity contracts: deaths, promises/payoffs, questions, casts, and durable state |
| `story import draft.md --title "The Lost Coast"` | Split an existing manuscript into a new story project and suggest entity candidates |
| `story report [path] --actionable` | Summarize inventory and optionally include next actions |
| `story next [path]` | Recommend the next deterministic writing or maintenance actions |
| `story doctor [path]` | Show health checks with actionable repair steps |
| `story export [path] --out manuscript.md` | Combine chapters into a single manuscript markdown file |
| `story build [path] --format epub` | Build disposable markdown, EPUB, or DOCX artifacts in `dist/` |

For a complete starter transcript, read [`docs/first-20-minutes.md`](docs/first-20-minutes.md). For the project contract, read [`docs/schema-v2.md`](docs/schema-v2.md) and [`schemas/story.schema.json`](schemas/story.schema.json).

Development uses Bun for tests and coverage:

```shell
bun run test
bun run test:coverage
bun run test:examples
bun run check:metadata
```

The copied-skill fallback CLI is generated from the package entrypoint. After changing CLI source, rebuild and check it before release:

```shell
bun run build:fallback
bun run check:fallback
node skills/story-maintenance/scripts/story.js --help
```

## 🤖 Write A Book Via Pull Requests

A story project with deterministic checks is a story project an agent can advance unattended. The [`templates/github/`](templates/github/) workflows turn a story repository into a self-drafting book:

- [`story-checks.yml`](templates/github/story-checks.yml) runs `story validate`, `story links`, and `story continuity` on every push and pull request, so a chapter PR cannot merge with a continuity contradiction.
- [`draft-next-chapter.yml`](templates/github/draft-next-chapter.yml) runs [Claude Code](https://github.com/anthropics/claude-code-action) on a schedule: it asks `story next` for the next deterministic action, drafts the next chapter with the chapter-writing skill, updates scene records and continuity state, runs the maintenance checks, and opens a pull request for review.

Copy both files into `.github/workflows/` in the repository that holds your story project, add an `ANTHROPIC_API_KEY` secret, and review one chapter PR per morning.

## 📥 Import An Existing Manuscript

Most writers don't start from a blank page. `story import` reverse-engineers a Story Skills project from work in progress:

```shell
story import draft.md --title "The Lost Coast" --genre mystery
```

It splits the manuscript on chapter headings (or imports a directory of chapter files), creates the full project layout with accurate word counts and registries, and prints recurring proper-name candidates so an agent can follow up with `story add character` and `story add location` to build out the bible.

## 📁 Project Structure

Running **story-init** creates this layout:

```
my-story/
├── story.md                  # Story bible — title, genre, themes, POV, tense
├── characters/
│   └── _index.md             # Character registry
├── worldbuilding/
│   ├── _index.md             # World overview
│   ├── locations/
│   ├── systems/
│   ├── factions/
│   └── artifacts/
├── plot/
│   ├── _index.md             # Arc overview
│   ├── arcs/
│   └── timeline.md
├── scenes/
│   └── _index.md             # Machine-readable scene registry
├── continuity/
│   ├── state.md              # Character, object, and knowledge state
│   ├── questions/
│   │   └── _index.md
│   └── promises/
│       └── _index.md
├── glossary/
│   ├── _index.md
│   └── terms/
└── chapters/
    └── _index.md             # Chapter registry
```

## ⚙️ How It Works

Every story element is a markdown file with YAML frontmatter. The skills cross-reference those files so the project stays consistent:

- **`story.md`** is the top-level bible read by all skills
- `story.md` includes **`schema-version: 2`** so the CLI can detect incompatible project formats
- Characters, locations, and arcs use **kebab-case identifiers** (e.g., `sera-voss`)
- **`_index.md`** files serve as registries for each domain
- Relationships and references are maintained **bidirectionally**
- Scene records and continuity state make character knowledge, object ownership, and setup/payoff tracking durable
- Story content is created directly as markdown; generated build scripts are not part of the project format

## 📖 Examples

- Read [**The Cormorant Tide**](https://github.com/danjdewhurst/the-cormorant-tide), a full story project generated with Story Skills.
- Explore [`examples/the-last-ember/`](examples/the-last-ember/) for a complete fantasy example: three characters, two locations, a magic system, a plot arc with foreshadowing, and a drafted first chapter.
- Explore [`examples/harbor-of-second-light/`](examples/harbor-of-second-light/) for a near-future coastal mystery example with memory technology, a posthumous witness arc, populated continuity state, and a drafted first chapter.
- Explore [`examples/the-unraveled-thread/`](examples/the-unraveled-thread/) for a deliberately broken project that demonstrates every class of finding the continuity engine reports.

## 🚢 Releasing

Codex uses `.codex-plugin/plugin.json` as its plugin version source. Claude Code uses `.claude-plugin/plugin.json`. Bump both versions for every published change so installed users receive updates; keep marketplace entries unversioned to avoid duplicate version state. Run `bun run check:metadata` before publishing to confirm package and plugin metadata are aligned.

Distribution metadata lives in `.claude-plugin/` for Claude Code and `.codex-plugin/` plus `.agents/plugins/marketplace.json` for Codex. The `plugins/story-skills` symlink is intentional: Codex marketplace entries must point at a child plugin directory, so the symlink exposes the repo-root plugin without duplicating `skills/`.

## 📄 License

[MIT](LICENSE)

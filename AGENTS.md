# Agent Instructions

These instructions apply to the entire `story-skills` repository. `CLAUDE.md` is a symlink to this file so Claude Code reads the same instructions. Edit this file and leave the symlink in place.

## Project Overview

Story Skills is a Bun/Node package that ships Agent Skills for fiction-writing workflows plus a small deterministic `story` CLI. The core format is plain markdown with YAML frontmatter. Skills guide creative workflows; the CLI handles mechanical maintenance such as validation, registry rebuilds, word counts, link checks, exports, and disposable builds.

Primary paths:

- `skills/` - published `SKILL.md` workflows and their reference files
- `src/` - source modules for the `story` CLI
- `bin/story.js` - package binary entrypoint
- `skills/story-maintenance/scripts/story.js` - Node-compatible bundled fallback CLI for copied skill installs
- `test/` - Bun tests
- `examples/` - sample Story Skills projects
- `scripts/` - CI check scripts and the release script
- `docs/` - user-facing guides, including the schema v2 reference
- `schemas/story.schema.json` - JSON schema for story project frontmatter
- `templates/github/` - GitHub Actions workflows users copy into a story repository for checks and scheduled chapter drafting
- `.codex-plugin/`, `.claude-plugin/`, `.agents/` - plugin and marketplace metadata
- `plugins/story-skills` - symlink to the repo root. Codex marketplace entries must point at a child plugin directory, so keep it a symlink rather than a copy.

## Development Commands

Use Bun for local development:

```shell
bun install
bun run story -- --help
bun run build:fallback
bun run check:fallback
bun run test
bun run test:coverage
bun run test:examples
bun run check:metadata
```

CI runs `check:metadata`, `test`, `test:coverage`, `test:examples`, and the fallback under Node in that order. Use `bun run test` for normal verification. Use `bun run build:fallback` after changing CLI behavior in `src/`, then use `bun run check:fallback` to confirm the generated fallback is current. Use `bun run test:coverage` when changes affect CLI behavior, parsing, project scanning, validation, fallback generation, or release readiness.

## Implementation Rules

- Keep runtime code compatible with Node 18 and the package's ESM style.
- Prefer standard `node:` imports and synchronous filesystem APIs where existing CLI code already uses them.
- Preserve the markdown-first project model. Do not add project-local generator scripts or build scripts that emit story content.
- When modifying CLI behavior in `src/`, run `bun run build:fallback` to regenerate `skills/story-maintenance/scripts/story.js` because copied skill installs rely on that fallback.
- Add or update focused Bun tests for behavior changes.
- Keep examples realistic and valid; if you change the story project format, update examples and tests together.

## Skill Authoring

- Every skill lives in `skills/<skill-name>/SKILL.md` with YAML frontmatter containing `name` and `description`.
- Keep skill instructions operational and agent-facing: what to read, what to edit, what checks to run, and when to ask the user.
- Reference files belong under the relevant skill's `references/` directory.
- Story entities should use kebab-case identifiers and maintain bidirectional links where the domain requires them.
- After instructions that add, remove, rename, or revise story entities, direct agents to run the appropriate maintenance commands: `story reindex`, `story wordcount --write`, `story links`, and/or `story validate`.

## Git And Commits

- Use Conventional Commits for commit messages, such as `feat: add chapter export option`, `fix: repair registry validation`, or `docs: update skill instructions`.
- Keep commits focused on one logical change.

## Release Metadata

For published changes, keep version metadata aligned across:

- `package.json`
- `.codex-plugin/plugin.json`
- `.claude-plugin/plugin.json`

Do not bump these by hand. `bun run release <patch|minor|major|X.Y.Z>` bumps all three, runs the CI checks, commits `chore: release X.Y.Z`, tags `vX.Y.Z`, pushes `main` and the tag, and creates the GitHub release. `--dry-run` runs the checks and stops before any change. Marketplace entries should remain unversioned unless the existing release process changes.

## Generated And Local Artifacts

Do not commit:

- `node_modules/`
- `coverage/`
- generated story build output under example `dist/` directories unless explicitly requested
- editor or OS swap files

## Review Checklist

Before finishing code or skill changes, check:

- The CI checks pass locally: `bun run check:metadata`, `bun run test`, `bun run test:coverage`, `bun run test:examples`.
- CLI help and skill docs still agree on command names and options.
- The bundled maintenance fallback is current: `bun run check:fallback`.
- The bundled maintenance fallback still runs with Node: `node skills/story-maintenance/scripts/story.js --help`.
- Registries, backlinks, and word counts remain deterministic for Story Skills projects.

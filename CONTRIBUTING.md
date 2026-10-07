# Contributing to Story Skills

Thanks for helping. This page is the short version. The [Development guide](docs/development.md) explains the repository layout, the CLI architecture, the tests, and the release process in full, and [`AGENTS.md`](AGENTS.md) holds the same rules for coding agents.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately, as described in [`SECURITY.md`](SECURITY.md), not in a public issue.

## Set up

Install the exact Bun version pinned by `packageManager` in `package.json`, and Node 18 or later. [Setting up](docs/development.md#setting-up) has the commands. Then:

```shell
bun install
bun run story -- --help
```

## Add a skill

1. Create `skills/<skill-name>/SKILL.md` with YAML frontmatter holding `name` (equal to the directory name) and `description` (the phrases and situations that should trigger it).
2. Write the instructions for the agent: what to read, what to edit, which checks to run, and when to ask the user. Put long templates and craft material under `skills/<skill-name>/references/`.
3. After any step that adds, removes, renames, or revises story entities, tell the agent which maintenance commands to run: `story reindex`, `story wordcount --write`, `story links`, and/or `story validate`.
4. Run `bun run check:metadata`.
5. Add the skill to the [Skills catalogue](docs/skills.md) and the skills table in the [README](README.md#skills).
6. If the skill changes drafting behaviour, run the model evals before and after, and consider an eval fixture. See [`evals/README.md`](evals/README.md).

[Authoring a skill](docs/development.md#authoring-a-skill) has the conventions the existing skills follow.

## Add a CLI command or flag

1. Put the logic in the module that owns it (`src/scan.js`, `src/validate.js`, `src/mutate.js`, `src/report.js`, `src/build.js`, or `src/story.js`) or in a feature module under `src/`, and export it. Re-export it from `src/story.js` when existing callers import it from there.
2. Register the command in `COMMANDS` in `src/commands.js` (use `project: "positional"` if it takes `[path]`), and any new flag in `OPTIONS` in `src/options.js`. Help text, argument parsing, and project-path handling follow from these entries, so never edit help by hand or add a separate dispatch branch.
3. Add focused Bun tests under `test/`.
4. Update the [CLI reference](docs/cli-reference.md), the command list in [`skills/story-maintenance/SKILL.md`](skills/story-maintenance/SKILL.md) (with a check command's rules in [`references/continuity-checks.md`](skills/story-maintenance/references/continuity-checks.md), an editing command's detail in [`references/editing-commands.md`](skills/story-maintenance/references/editing-commands.md), and a build format's in [`references/builds.md`](skills/story-maintenance/references/builds.md)), and the "Companion CLI" section of the README.
5. Rebuild the bundled fallback and check it is current: `bun run build:fallback`, then `bun run check:fallback`. Commit the regenerated `skills/story-maintenance/scripts/story.js` with the change.

See [Adding a command](docs/development.md#adding-a-command) and [Adding a flag](docs/development.md#adding-a-flag). If you change the project format, update `schemas/story.schema.json`, the examples, and the tests together.

## Run the checks

Run what CI runs, in this order, before you open a pull request:

```shell
bun run check:metadata
bun run check:evals
bun run check:links
bun run eval:selftest
bun run test:coverage
bun run test:examples
node skills/story-maintenance/scripts/story.js --help
```

`test:coverage` runs the whole suite, as `bun run test` does, then requires every line and function in `src/` to be covered and at least 85% of the lines in each file in `scripts/` and `evals/`, and also runs `check:fallback`. [CI](docs/development.md#ci) describes the full workflow, including the Node 18, 20, and 22 matrix.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat: add chapter export option`, `fix: repair registry validation`, `docs: update skill instructions`.
- Keep each commit to one logical change.
- Update a branch by rebasing onto `main`, not by merging `main` in. Force-push a rebased branch only with `--force-with-lease`.
- Do not bump version numbers. The maintainer's release script does that.

## Changelog

Add an entry under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md) for any change a user would notice, using the Keep a Changelog headings (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`). Always add one for a change to the project format or to CLI behaviour: people who copy the skills run the bundled fallback CLI and need to know what changed. Internal refactors, tests, and CI changes need no entry.

`bun run release` refuses to run while `Unreleased` is empty, and moves its entries under the new version when it cuts the release.

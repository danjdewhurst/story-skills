## Summary

<!-- What changes, and why. Link the issue it resolves, for example "Closes #123". -->

## Checklist

<!-- Tick what applies. Strike through or delete items that do not. -->

- [ ] The title and commits follow [Conventional Commits](https://www.conventionalcommits.org/), one logical change per commit.
- [ ] `CHANGELOG.md` has an entry under `## [Unreleased]` for any change a user would notice, and always for a change to the project format or CLI behaviour.
- [ ] After changing `src/`, I ran `bun run build:fallback` and committed the regenerated `skills/story-maintenance/scripts/story.js`.
- [ ] New commands are registered in `src/commands.js` and new flags in `src/options.js`, and the CLI reference, `skills/story-maintenance/SKILL.md`, and the README agree with `story --help`.
- [ ] A project format change updates `schemas/story.schema.json`, the examples, and the tests together.
- [ ] Behaviour changes have focused Bun tests.
- [ ] No version numbers are bumped.
- [ ] The CI checks pass locally:

```shell
bun run check:metadata
bun run check:evals
bun run eval:selftest
bun run test
bun run test:coverage
bun run test:examples
node skills/story-maintenance/scripts/story.js --help
```

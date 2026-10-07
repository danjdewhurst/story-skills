import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import { hasVersionSection, promoteUnreleased, unreleasedEntries } from "../scripts/changelog.js";
import { CHANGELOG_LEAD_LIMIT, checkChangelogEntries, checkChangelogVersion } from "../scripts/check-metadata.js";
import { changelogProblemFor, updateChangelog } from "../scripts/release.js";

const repoRoot = path.resolve(import.meta.dir, "..");
const URL = "https://github.com/danjdewhurst/story-skills/compare";

const changelog = (unreleased) => `# Changelog

Intro.

## [Unreleased]
${unreleased}
## [1.2.3] - 2026-01-01

### Fixed

- Old fix.

[Unreleased]: ${URL}/v1.2.3...HEAD
[1.2.3]: ${URL}/v1.2.2...v1.2.3
`;

describe("changelog", () => {
  test("counts only list items under Unreleased", () => {
    expect(unreleasedEntries(changelog("\n"))).toEqual([]);
    expect(unreleasedEntries(changelog("\n### Added\n\n"))).toEqual([]);
    expect(unreleasedEntries(changelog("\n### Added\n\n- New thing.\n* Other thing.\n\n"))).toEqual(["- New thing.", "* Other thing."]);
    expect(unreleasedEntries("# Changelog\n\n## [1.0.0] - 2026-01-01\n\n- Old.\n")).toEqual([]);
  });

  test("promotes Unreleased entries under the new version and updates the links", () => {
    const promoted = promoteUnreleased(changelog("\n### Added\n\n- New thing.\n\n"), "1.2.3", "1.3.0", "2026-02-03");
    expect(promoted).toBe(`# Changelog

Intro.

## [Unreleased]

## [1.3.0] - 2026-02-03

### Added

- New thing.

## [1.2.3] - 2026-01-01

### Fixed

- Old fix.

[Unreleased]: ${URL}/v1.3.0...HEAD
[1.3.0]: ${URL}/v1.2.3...v1.3.0
[1.2.3]: ${URL}/v1.2.2...v1.2.3
`);
    expect(unreleasedEntries(promoted)).toEqual([]);
    expect(checkChangelogVersion([], "1.3.0", promoted)).toEqual([]);
  });

  test("appends links when the file has none", () => {
    const promoted = promoteUnreleased("# Changelog\n\n## [Unreleased]\n\n- New.\n", "0.1.0", "0.2.0", "2026-02-03");
    expect(promoted).toBe(`# Changelog\n\n## [Unreleased]\n\n## [0.2.0] - 2026-02-03\n\n- New.\n\n[Unreleased]: ${URL}/v0.2.0...HEAD\n[0.2.0]: ${URL}/v0.1.0...v0.2.0\n`);
  });

  test("refuses an empty or missing Unreleased section and a duplicate version", () => {
    expect(() => promoteUnreleased(changelog("\n"), "1.2.3", "1.3.0", "2026-02-03")).toThrow("no entries");
    expect(() => promoteUnreleased("# Changelog\n", "1.2.3", "1.3.0", "2026-02-03")).toThrow('no "## [Unreleased]"');
    expect(() => promoteUnreleased(changelog("\n- New.\n\n"), "1.2.2", "1.2.3", "2026-02-03")).toThrow("already has a section for 1.2.3");
  });

  test("the release preflight reports an empty Unreleased section and a duplicate version", () => {
    expect(changelogProblemFor(changelog("\n"), "1.2.4")).toContain('no entries under "## [Unreleased]"');
    expect(changelogProblemFor(changelog("\n- New.\n\n"), "1.2.4")).toBeNull();
    expect(changelogProblemFor(changelog("\n- New.\n\n"), "1.2.3")).toBe(
      'CHANGELOG.md already has a section for 1.2.3. Move its entries back under "## [Unreleased]" and remove its heading, or release a later version.'
    );
    expect(hasVersionSection(changelog("\n"), "1.2.3")).toBe(true);
    expect(hasVersionSection(changelog("\n"), "1.2.30")).toBe(false);
    expect(hasVersionSection("## [1x2x3] - 2026-01-01\n", "1.2.3")).toBe(false);
  });

  test("updateChangelog rewrites the file in place", () => {
    const dir = makeTempDir("story-changelog-");
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), changelog("\n- New.\n\n"), "utf8");
    expect(updateChangelog(dir, "1.2.3", "1.2.4", "2026-02-03")).toBe("CHANGELOG.md");
    expect(fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf8")).toContain("## [1.2.4] - 2026-02-03\n\n- New.\n");
  });

  test("check:metadata requires a dated section and link for the package version", () => {
    expect(checkChangelogVersion([], "1.2.3", changelog("\n"))).toEqual([]);
    expect(checkChangelogVersion([], "1.2.4", changelog("\n"))).toEqual([
      'CHANGELOG.md is missing a "## [1.2.4] - YYYY-MM-DD" section',
      "CHANGELOG.md is missing the [1.2.4] link reference"
    ]);
    expect(checkChangelogVersion([], "1.2.3", changelog("\n").replace("## [Unreleased]\n", ""))).toEqual([
      'CHANGELOG.md is missing the "## [Unreleased]" section'
    ]);
  });

  test("the repository changelog matches the package version", () => {
    const version = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
    expect(checkChangelogVersion([], version, fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8"))).toEqual([]);
  });

  // #605: entries were single paragraphs of up to 2,000 characters.
  test("check:metadata keeps each entry's first line short and leaves sub-bullets alone", () => {
    const link = `([#605](https://github.com/danjdewhurst/story-skills/issues/605${"/x".repeat(100)}))`;
    const lead = "a".repeat(CHANGELOG_LEAD_LIMIT - "(#605)".length - 1);
    const fits = changelog(`\n### Fixed\n\n- ${lead} ${link}\n  - ${"Detail. ".repeat(60)}\n    - ${"More. ".repeat(60)}\n\n`);
    expect(checkChangelogEntries([], fits)).toEqual([]);

    const tooLong = changelog(`\n### Fixed\n\n- ${lead}b ${link}\n* ${"c".repeat(250)}\n\n`);
    expect(checkChangelogEntries([], tooLong)).toEqual([
      `CHANGELOG.md:9 entry's first line is ${CHANGELOG_LEAD_LIMIT + 1} characters, over ${CHANGELOG_LEAD_LIMIT}: lead with one short sentence and move the detail into indented sub-bullets`,
      `CHANGELOG.md:10 entry's first line is 250 characters, over ${CHANGELOG_LEAD_LIMIT}: lead with one short sentence and move the detail into indented sub-bullets`
    ]);
    expect(checkChangelogEntries([], tooLong.replaceAll("\n", "\r\n"))).toHaveLength(2);
  });

  test("the repository changelog keeps every entry's first line short", () => {
    expect(checkChangelogEntries([], fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8"))).toEqual([]);
  });

  test("the release moves an entry's sub-bullets with it and counts only the entry", () => {
    const text = changelog("\n### Added\n\n- New thing. (#1)\n  - Detail.\n    - Deeper detail.\n\n");
    expect(unreleasedEntries(text)).toEqual(["- New thing. (#1)"]);
    expect(promoteUnreleased(text, "1.2.3", "1.3.0", "2026-02-03")).toContain(
      "## [Unreleased]\n\n## [1.3.0] - 2026-02-03\n\n### Added\n\n- New thing. (#1)\n  - Detail.\n    - Deeper detail.\n\n## [1.2.3]"
    );
  });
});

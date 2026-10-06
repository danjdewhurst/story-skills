// CHANGELOG.md follows Keep a Changelog. Changes land under `## [Unreleased]`,
// and the release script moves them into a dated section for the new version.

export const CHANGELOG_FILE = "CHANGELOG.md";
const COMPARE_URL = "https://github.com/danjdewhurst/story-skills/compare";
const UNRELEASED_HEADING = /^## \[Unreleased\][^\n]*\n/m;

function unreleasedBounds(text) {
  const heading = UNRELEASED_HEADING.exec(text);
  if (!heading) {
    return null;
  }
  const start = heading.index + heading[0].length;
  const rest = text.slice(start);
  // The section ends at the next release heading or the link references.
  const next = /^(## \[|\[[^\]]+\]: )/m.exec(rest);
  return { headingStart: heading.index, start, end: next ? start + next.index : text.length };
}

// The list items under `## [Unreleased]`, so an empty `### Added` heading
// alone does not count as an entry.
export function unreleasedEntries(text) {
  const bounds = unreleasedBounds(text);
  if (!bounds) {
    return [];
  }
  return text
    .slice(bounds.start, bounds.end)
    .split("\n")
    .filter((line) => /^[-*] \S/.test(line));
}

// Whether the changelog already has a `## [version]` section.
export function hasVersionSection(text, version) {
  return new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\]`, "m").test(text);
}

// Move the Unreleased entries under `## [next] - date`, leave an empty
// Unreleased section above it, and update the compare links at the foot.
export function promoteUnreleased(text, current, next, date) {
  const bounds = unreleasedBounds(text);
  if (!bounds) {
    throw new Error(`${CHANGELOG_FILE} has no "## [Unreleased]" section.`);
  }
  if (unreleasedEntries(text).length === 0) {
    throw new Error(`${CHANGELOG_FILE} has no entries under "## [Unreleased]".`);
  }
  if (hasVersionSection(text, next)) {
    throw new Error(`${CHANGELOG_FILE} already has a section for ${next}.`);
  }
  const body = text.slice(bounds.start, bounds.end).trim();
  let result = `${text.slice(0, bounds.headingStart)}## [Unreleased]\n\n## [${next}] - ${date}\n\n${body}\n\n${text.slice(bounds.end)}`;
  const unreleasedLink = /^\[Unreleased\]: .*$/m;
  const links = `[Unreleased]: ${COMPARE_URL}/v${next}...HEAD\n[${next}]: ${COMPARE_URL}/v${current}...v${next}`;
  result = unreleasedLink.test(result) ? result.replace(unreleasedLink, links) : `${result.trimEnd()}\n\n${links}\n`;
  return result;
}

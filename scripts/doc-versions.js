import fs from "node:fs";
import path from "node:path";

// Version examples in the docs that name the current release: `--version`
// output lines, pinned npm and GitHub-tag installs, the STORY_REF sample, and
// the `git checkout` tip. Other version mentions, such as history ("newer than
// 0.8.2") or git refs in examples, are not matched and never change.
const EXAMPLE_PATTERNS = [
  /^()(\d+\.\d+\.\d+)$/gm,
  /(story-skills@)(\d+\.\d+\.\d+)/g,
  /(story-skills#v)(\d+\.\d+\.\d+)/g,
  /(STORY_REF:\s*"v)(\d+\.\d+\.\d+)/g,
  /(git checkout v)(\d+\.\d+\.\d+)/g
];

// The release-script transcript in the development guide, which also names
// the patch release after the current one.
const TRANSCRIPT_PATTERN = /^Releasing (\d+\.\d+\.\d+) -> (\d+\.\d+\.\d+) \(v\2\)$/gm;

function nextPatch(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

export function docVersionFiles(root) {
  const docsDir = path.join(root, "docs");
  const docs = fs.existsSync(docsDir)
    ? fs
        .readdirSync(docsDir)
        .filter((name) => name.endsWith(".md"))
        .sort()
        .map((name) => `docs/${name}`)
    : [];
  return ["README.md", ...docs].filter((relativePath) => fs.existsSync(path.join(root, relativePath)));
}

export function bumpDocVersions(text, current, next) {
  let result = text;
  for (const pattern of EXAMPLE_PATTERNS) {
    result = result.replace(pattern, (match, prefix, version) => (version === current ? `${prefix}${next}` : match));
  }
  return result.replace(TRANSCRIPT_PATTERN, (match, from) => {
    if (from !== current) {
      return match;
    }
    const after = nextPatch(next);
    return `Releasing ${next} -> ${after} (v${after})`;
  });
}

// Every version example that does not name the given version, as
// { line, found } pairs, so check:metadata can report stale docs.
export function staleDocVersions(text, version) {
  const stale = [];
  const record = (index, found) => {
    if (found !== version) {
      stale.push({ line: text.slice(0, index).split("\n").length, found });
    }
  };
  for (const pattern of [...EXAMPLE_PATTERNS, TRANSCRIPT_PATTERN]) {
    for (const match of text.matchAll(pattern)) {
      record(match.index, pattern === TRANSCRIPT_PATTERN ? match[1] : match[2]);
    }
  }
  return stale.sort((a, b) => a.line - b.line);
}

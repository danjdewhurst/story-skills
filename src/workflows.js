import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectPath, readTextFile } from "./files.js";
import { VERSION } from "./version.js";

// The GitHub Actions templates pin the CLI with an env line such as
// `STORY_VERSION: "0.21.0"` (in templates from 0.21.0 and earlier,
// `STORY_REF: "v0.21.0"`), which an uncommented `STORY_PACKAGE` line
// overrides. Dependabot cannot bump an env value, so story doctor reads the
// workflows next to the project, and in the git repository root above it,
// and notes a pin older or newer than the running CLI, or the legacy name.
// It only matches the env lines, never parses YAML, and a missing or
// unreadable file is skipped, as is a symlink, a FIFO, or a file over the
// read limit.
const ENV_LINE = /^\s*(STORY_VERSION|STORY_REF|STORY_PACKAGE)\s*:\s*["']?([^"'\s#]*)/;
// One exact release, as npm installs it: X.Y.Z with an optional "v", an
// optional prerelease (-rc.1), and optional build metadata (+build), which
// does not count when comparing. A dist-tag such as `latest`, a range, or a
// partial version does not say which release CI installs, so it gets no
// note.
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const RELEASES = "https://github.com/danjdewhurst/story-skills/releases";

// The low-priority doctor actions for the workflow pins under `projectRoot`,
// with file paths shown relative to `cwd`.
export function workflowPinActions(projectRoot, cwd = projectRoot) {
  const current = parseVersion(VERSION);
  const actions = [];
  for (const pin of workflowPins(projectRoot)) {
    const where = `${projectPath(cwd, pin.file) || pin.file}:${pin.line}`;
    const parsed = parseVersion(pin.value);
    if (pin.name === "STORY_REF" && parsed === null) {
      // A branch or commit, which the current templates install through
      // STORY_PACKAGE rather than a release.
      actions.push(action("Rename workflow STORY_REF", `${where} sets the legacy STORY_REF to ${pin.value || "an empty value"}; replace the line with STORY_PACKAGE: "github:danjdewhurst/story-skills#${pin.value || "<ref>"}" and copy the install step from the current template (see Upgrading the workflows in docs/automation.md).`));
    } else if (pin.name === "STORY_REF") {
      // Keep the release the workflow already pins, without its "v", unless
      // it is older than this CLI.
      const target = compareVersions(parsed, current) > 0 ? parsed.text : VERSION;
      actions.push(action("Rename workflow STORY_REF", `${where} sets the legacy STORY_REF; change the line to STORY_VERSION: "${target}" and copy the install step from the current template (see Upgrading the workflows in docs/automation.md).`));
    } else if (parsed && !pin.overridden) {
      const order = compareVersions(parsed, current);
      if (order < 0) {
        actions.push(action("Update workflow CLI version", `${where} installs story-skills ${parsed.text}, older than this CLI (${VERSION}); after story check passes locally, change the line to STORY_VERSION: "${VERSION}".`));
      } else if (order > 0) {
        // CI runs the newer release, so local checks can miss what it reports.
        actions.push(action("Update local CLI version", `${where} installs story-skills ${parsed.text}, newer than this CLI (${VERSION}), so CI can report findings that story check here does not; ${cliUpdateHint(parsed.text)}.`));
      }
    }
  }
  return actions;
}

// How to bring this CLI up to `version`, judged from where its code runs.
// `file` is this module, or the one file that bundles it: the bundled
// fallback, or a compiled binary under Bun's /$bunfs/ (B:/~BUN/ on
// Windows), whose `execPath` resolves into Homebrew's Cellar when brew
// installed it. A layout it does not recognise points to the docs.
export function cliUpdateHint(version, file = fileURLToPath(import.meta.url), execPath = process.execPath) {
  const location = file.replace(/\\/g, "/");
  if (/\/(\$bunfs|~BUN)\//.test(location)) {
    return /\/Cellar\/story-skills\//.test(realPath(execPath).replace(/\\/g, "/"))
      ? "update it with brew upgrade story-skills"
      : `download the ${version} binary for your system from ${RELEASES}/tag/v${version}`;
  }
  // pnpm keeps packages under node_modules/.pnpm/, whether global or not.
  const npm = location.includes("/.pnpm/") ? null : /^(.*)\/node_modules\/story-skills\//.exec(location);
  if (npm && location.includes("/_npx/")) {
    return `run that release with npx story-skills@${version}`;
  }
  if (npm && /\/bunx-[^/]*\//.test(location)) {
    return `run that release with bunx story-skills@${version}`;
  }
  if (npm && location.includes("/.bun/install/global/")) {
    return `update it with bun add -g story-skills@${version}`;
  }
  if (npm && fs.existsSync(path.join(npm[1], "package.json"))) {
    return `update the story-skills dependency in ${npm[1]}/package.json to ${version}`;
  }
  if (npm) {
    return `update it with npm install -g story-skills@${version}`;
  }
  if (location.endsWith("/story-maintenance/scripts/story.js")) {
    return "update the Story Skills plugin or skills, which carry this bundled CLI (see Update the skills in docs/getting-started.md)";
  }
  const clone = /^(.*)\/src\/workflows\.js$/.exec(location);
  if (clone && fs.existsSync(path.join(clone[1], ".git"))) {
    return `update the clone in ${clone[1]} with git pull`;
  }
  return `update it to ${version} (see Update or pin the CLI in docs/getting-started.md)`;
}

function realPath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

// Every STORY_VERSION or STORY_REF line in the workflow files, in file and
// line order. `overridden` is true when the file also sets STORY_PACKAGE,
// so its STORY_VERSION is not what the install step uses.
function workflowPins(projectRoot) {
  const pins = [];
  for (const file of workflowFiles(projectRoot)) {
    let text;
    try {
      text = readTextFile(file);
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/).map((content, index) => ({ match: ENV_LINE.exec(content), line: index + 1 })).filter((entry) => entry.match);
    const overridden = lines.some((entry) => entry.match[1] === "STORY_PACKAGE");
    for (const { match, line } of lines) {
      if (match[1] !== "STORY_PACKAGE") {
        pins.push({ file, line, name: match[1], value: match[2], overridden });
      }
    }
  }
  return pins;
}

function workflowFiles(projectRoot) {
  const dirs = [projectRoot];
  const gitRoot = findGitRoot(projectRoot);
  if (gitRoot !== null && gitRoot !== projectRoot) {
    dirs.push(gitRoot);
  }
  const files = [];
  for (const dir of dirs) {
    const workflows = path.join(dir, ".github", "workflows");
    let names;
    try {
      names = fs.readdirSync(workflows);
    } catch {
      continue;
    }
    for (const name of names.filter((entry) => /\.ya?ml$/.test(entry)).sort()) {
      files.push(path.join(workflows, name));
    }
  }
  return files;
}

// The nearest directory at or above `start` holding `.git` (a directory, or
// a file in a linked worktree), or null.
function findGitRoot(start) {
  let dir = path.resolve(start);
  while (!fs.existsSync(path.join(dir, ".git"))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return dir;
}

// { numbers: [major, minor, patch], pre: prerelease identifiers, text: the
// release as npm names it, without the "v" or build metadata }, or null for
// anything but one exact release.
export function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const text = match[4] ? `${match.slice(1, 4).join(".")}-${match[4]}` : match.slice(1, 4).join(".");
  return { numbers: match.slice(1, 4).map(Number), pre: match[4] ? match[4].split(".") : [], text };
}

// Semver order: the numbers, then a prerelease before its release, then the
// prerelease identifiers in turn, a number before a word, and a shorter list
// first when one runs out.
export function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] - right.numbers[index];
    }
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    return right.pre.length - left.pre.length;
  }
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const order = compareIdentifiers(left.pre[index], right.pre[index]);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

function compareIdentifiers(left, right) {
  if (left === undefined || right === undefined) {
    return left === undefined ? -1 : 1;
  }
  const [leftNumber, rightNumber] = [left, right].map((identifier) => /^\d+$/.test(identifier));
  if (leftNumber && rightNumber) {
    return Math.sign(Number(left) - Number(right));
  }
  if (leftNumber !== rightNumber) {
    return leftNumber ? -1 : 1;
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

function action(title, detail) {
  return { priority: "P3", title, detail };
}

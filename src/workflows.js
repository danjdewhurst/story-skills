import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectPath, readTextFile } from "./files.js";
import { VERSION } from "./version.js";

// The GitHub Actions templates pin the CLI with an env line such as
// `STORY_VERSION: "0.21.0"` (in templates from 0.21.0 and earlier,
// `STORY_REF: "v0.21.0"`), which a non-empty `STORY_PACKAGE` line in the
// same scope overrides. Dependabot cannot bump an env value, so story
// doctor reads the workflows next to the project, and in the git repository
// root above it, and notes a pin older or newer than the running CLI, or
// the legacy name. It only matches the env lines and reads their scope from
// indentation, never parses YAML, and a missing or unreadable file is
// skipped, as is a symlink, a FIFO, or a file over the read limit.
const ENV_LINE = /^\s*(STORY_VERSION|STORY_REF|STORY_PACKAGE)\s*:\s*["']?([^"'\s#]*)/;
// One exact release, as semver writes it: X.Y.Z with an optional "v", an
// optional prerelease (-rc.1), and optional build metadata (+build), which
// does not count when comparing. Numbers have no leading zeros and must be
// safe integers. A dist-tag such as `latest`, a range, or a partial version
// does not say which release CI installs, so it gets no note.
const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
// Notes echo what a workflow pins, and a cloned project's workflow is not
// trusted, so a longer prerelease or build is not a release, and a
// STORY_REF is shown only when it looks like a git ref of modest length.
// That keeps a crafted value from flooding doctor's output or putting
// control characters on the terminal.
const MAX_LABEL = 64;
const SHOWN_REF = /^[\w./@+-]{1,100}$/;
const RELEASES = "https://github.com/danjdewhurst/story-skills/releases";

// The low-priority doctor actions for the workflow pins under `projectRoot`,
// with file paths shown relative to `cwd`.
export function workflowPinActions(projectRoot, cwd = projectRoot) {
  const current = parseVersion(VERSION);
  const actions = [];
  const newer = [];
  for (const pin of workflowPins(projectRoot)) {
    const where = `${projectPath(cwd, pin.file) || pin.file}:${pin.line}`;
    const parsed = parseVersion(pin.value);
    if (pin.name === "STORY_REF" && parsed === null) {
      // A branch or commit, which the current templates install through
      // STORY_PACKAGE rather than a release.
      const ref = SHOWN_REF.test(pin.value) ? pin.value : null;
      const named = ref ?? (pin.value === "" ? "an empty value" : "a value that is not a release");
      actions.push(action("Rename workflow STORY_REF", `${where} sets the legacy STORY_REF to ${named}; replace the line with STORY_PACKAGE: "github:danjdewhurst/story-skills#${ref ?? "<ref>"}" and copy the install step from the current template (see Upgrading the workflows in docs/automation.md).`));
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
        newer.push({ where, version: parsed });
      }
    }
  }
  if (newer.length > 0) {
    actions.push(newerPinAction(newer));
  }
  return actions;
}

// One note for every pin newer than this CLI, since CI then runs checks
// this CLI lacks, and one update covers them all. It names the newest
// release, and the release each line pins when they differ.
function newerPinAction(pins) {
  const newest = pins.reduce((best, pin) => (compareVersions(pin.version, best) > 0 ? pin.version : best), pins[0].version);
  const same = pins.every((pin) => pin.version.text === newest.text);
  const lines = pins.map((pin) => (same ? pin.where : `${pin.where} (${pin.version.text})`));
  const listed = lines.length === 1 ? lines[0] : `${lines.slice(0, -1).join(", ")} and ${lines[lines.length - 1]}`;
  const installs = !same ? "install story-skills releases" : `${pins.length === 1 ? "installs" : "install"} story-skills ${newest.text},`;
  return action("Update local CLI version", `${listed} ${installs} newer than this CLI (${VERSION}), so CI can report findings that story check here does not; ${cliUpdateHint(newest.text)}.`);
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
  // The folder that directly holds node_modules/story-skills.
  const holder = /^(.*)\/node_modules\/story-skills\//.exec(location)?.[1];
  if (holder !== undefined) {
    return packageHint(holder, version);
  }
  if (location.endsWith("/story-maintenance/scripts/story.js")) {
    return "update the Story Skills plugin or skills, which carry this bundled CLI (see Update the skills in docs/getting-started.md)";
  }
  const clone = /^(.*)\/src\/workflows\.js$/.exec(location)?.[1];
  const head = clone === undefined ? null : gitHead(clone);
  if (head === "branch") {
    return `update the clone in ${clone} with git pull`;
  }
  if (head === "detached") {
    // Such as a release tag checked out, where git pull fails.
    return `update the clone in ${clone} with git fetch --tags and git checkout v${version}`;
  }
  return docsHint(version);
}

// The hint for a CLI in <holder>/node_modules/story-skills. Every command
// it names leaves the project's package config alone: npx reads the .npmrc
// in the folder it runs in, and a cloned project can carry one that points
// at another registry or shell, as bunx can a bunfig.toml, while a global
// npm or Bun install ignores both. So an npx or bunx user is told to
// install the release globally.
function packageHint(holder, version) {
  if (holder.includes("/node_modules/")) {
    // A dependency of another package, or pnpm's store, which that package
    // or pnpm updates.
    return docsHint(version);
  }
  if (holder.includes("/_npx/")) {
    return `install that release with npm install -g story-skills@${version}`;
  }
  if (/\/bunx-[^/]*$/.test(holder)) {
    return `install that release with bun add -g story-skills@${version}`;
  }
  if (holder.endsWith("/.bun/install/global")) {
    return `update it with bun add -g story-skills@${version}`;
  }
  if (fs.existsSync(path.join(holder, "package.json"))) {
    return `update the story-skills dependency in ${holder}/package.json to ${version}`;
  }
  // npm's global folder: <prefix>/lib/node_modules on macOS and Linux, and
  // <prefix>/node_modules on Windows, where the prefix is %APPDATA%\npm, or
  // the nodejs folder under nvm-windows. Anything else, such as a Yarn
  // Plug'n'Play zip, gets the docs.
  if (/\/(lib|npm|nodejs)$/i.test(holder)) {
    return `update it with npm install -g story-skills@${version}`;
  }
  return docsHint(version);
}

function docsHint(version) {
  return `update it to ${version} (see Update or pin the CLI in docs/getting-started.md)`;
}

function realPath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

// Whether the clone at `root` has a branch checked out ("branch"), a
// detached HEAD ("detached"), or no readable HEAD (null). In a linked
// worktree, `.git` is a file that names the git folder. Both are read with
// the guarded reads, so a symlink or FIFO counts as no clone.
function gitHead(root) {
  try {
    let gitDir = path.join(root, ".git");
    if (fs.statSync(gitDir).isFile()) {
      gitDir = path.resolve(root, /^gitdir:\s*(.+?)\s*$/m.exec(readTextFile(gitDir))[1]);
    }
    return readTextFile(path.join(gitDir, "HEAD")).startsWith("ref:") ? "branch" : "detached";
  } catch {
    return null;
  }
}

// Every STORY_VERSION or STORY_REF line in the workflow files, in file and
// line order. `overridden` is true when a non-empty STORY_PACKAGE is set
// for the same owner (the workflow, a job, or a step) or one around it, so
// the install step there uses it rather than STORY_VERSION. An empty one
// does not count, since the templates read it as ${STORY_PACKAGE:-...}, and
// one in another job or step does not reach this pin.
function workflowPins(projectRoot) {
  const pins = [];
  for (const file of workflowFiles(projectRoot)) {
    let text;
    try {
      text = readTextFile(file);
    } catch {
      continue;
    }
    const entries = envLines(text);
    const packages = entries.filter((entry) => entry.name === "STORY_PACKAGE" && entry.value !== "");
    for (const entry of entries) {
      if (entry.name !== "STORY_PACKAGE") {
        const overridden = packages.some((item) => item.scope.every((id, index) => entry.scope[index] === id));
        pins.push({ file, line: entry.line, name: entry.name, value: entry.value, overridden });
      }
    }
  }
  return pins;
}

// The STORY_* env lines in a workflow, each with its scope: the lines that
// open the mappings around its env block (a job, a step), outermost first,
// found by indentation. A sequence item (`- name: ...`) opens the item and
// then its first key, so a step's env block belongs to the step.
function envLines(text) {
  const entries = [];
  const open = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const content = lines[index];
    const indent = content.search(/\S/);
    if (indent === -1 || content[indent] === "#") {
      continue;
    }
    while (open.length > 0 && open[open.length - 1].indent >= indent) {
      open.pop();
    }
    const match = ENV_LINE.exec(content);
    if (match) {
      // Without the env block itself, so a STORY_PACKAGE in a job's env
      // reaches a STORY_VERSION in the env of a step in that job.
      entries.push({ line: index + 1, name: match[1], value: match[2], scope: open.slice(0, -1).map((item) => item.id) });
    }
    open.push({ indent, id: `${index}` });
    const item = /^-\s+(?=\S)/.exec(content.slice(indent));
    if (item) {
      open.push({ indent: indent + item[0].length, id: `${index}:key` });
    }
  }
  return entries;
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
  if (match === null || (match[4] ?? "").length > MAX_LABEL || (match[5] ?? "").length > MAX_LABEL) {
    return null;
  }
  const numbers = match.slice(1, 4).map(Number);
  const pre = match[4] === undefined ? [] : match[4].split(".");
  if (![...numbers, ...pre.filter(isNumeric).map(Number)].every(Number.isSafeInteger)) {
    return null;
  }
  return { numbers, pre, text: match[4] === undefined ? numbers.join(".") : `${numbers.join(".")}-${match[4]}` };
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
  if (isNumeric(left) && isNumeric(right)) {
    return Math.sign(Number(left) - Number(right));
  }
  if (isNumeric(left) !== isNumeric(right)) {
    return isNumeric(left) ? -1 : 1;
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

function isNumeric(identifier) {
  return /^\d+$/.test(identifier);
}

function action(title, detail) {
  return { priority: "P3", title, detail };
}

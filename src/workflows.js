import fs from "node:fs";
import path from "node:path";
import { projectPath } from "./files.js";
import { VERSION } from "./version.js";

// The GitHub Actions templates pin the CLI with an env line such as
// `STORY_VERSION: "0.21.0"` (in templates from 0.21.0 and earlier,
// `STORY_REF: "v0.21.0"`), which an uncommented `STORY_PACKAGE` line
// overrides. Dependabot cannot bump an env value, so story doctor reads the
// workflows next to the project, and in the git repository root above it,
// and notes a pin older than the running CLI or the legacy name. It only
// matches the env lines, never parses YAML, and a missing or unreadable file
// is skipped.
const ENV_LINE = /^\s*(STORY_VERSION|STORY_REF|STORY_PACKAGE)\s*:\s*["']?([^"'\s#]*)/;
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)/;

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
      const target = compareVersions(parsed, current) > 0 ? parsed.join(".") : VERSION;
      actions.push(action("Rename workflow STORY_REF", `${where} sets the legacy STORY_REF; change the line to STORY_VERSION: "${target}" and copy the install step from the current template (see Upgrading the workflows in docs/automation.md).`));
    } else if (parsed && !pin.overridden && compareVersions(parsed, current) < 0) {
      actions.push(action("Update workflow CLI version", `${where} installs story-skills ${parsed.join(".")}, older than this CLI (${VERSION}); after story check passes locally, change the line to STORY_VERSION: "${VERSION}".`));
    }
  }
  return actions;
}

// Every STORY_VERSION or STORY_REF line in the workflow files, in file and
// line order. `overridden` is true when the file also sets STORY_PACKAGE,
// so its STORY_VERSION is not what the install step uses.
function workflowPins(projectRoot) {
  const pins = [];
  for (const file of workflowFiles(projectRoot)) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
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

function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function action(title, detail) {
  return { priority: "P3", title, detail };
}

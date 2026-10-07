#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFrontmatter } from "../src/frontmatter.js";
import { parsePinnedBunVersion } from "./bun-pin.js";
import { docVersionFiles, staleDocVersions } from "./doc-versions.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function expectEqual(failures, label, expected, actual) {
  if (actual !== expected) {
    failures.push(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
  return failures;
}

export function checkVersionModule(failures, packageVersion, source) {
  const match = /export const VERSION = "([^"]+)";/.exec(source);
  if (!match) {
    failures.push("src/version.js is missing export const VERSION");
    return failures;
  }
  return expectEqual(failures, "src/version.js VERSION", packageVersion, match[1]);
}

export function checkSkillFrontmatter(failures, skillsDir, readFile) {
  for (const skillName of fs.readdirSync(skillsDir).sort()) {
    const skillDir = path.join(skillsDir, skillName);
    if (!fs.statSync(skillDir).isDirectory()) {
      continue;
    }

    const skillPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      failures.push(`skills/${skillName} is missing SKILL.md`);
      continue;
    }

    const markdown = readFile(skillPath);
    const frontmatter = parseFrontmatter(markdown, skillPath).data;
    expectEqual(failures, `skills/${skillName}/SKILL.md name`, skillName, frontmatter.name);
    if (typeof frontmatter.description !== "string" || frontmatter.description.trim() === "") {
      failures.push(`skills/${skillName}/SKILL.md is missing description`);
    }
  }
  return failures;
}

export function checkTemplateStoryVersion(failures, packageVersion, templatesDir, readFile) {
  for (const name of ["story-checks.yml", "draft-next-chapter.yml", "review-copy.yml"]) {
    const text = readFile(path.join(templatesDir, name));
    const match = /^\s*STORY_VERSION:\s*"([^"]+)"/m.exec(text);
    if (!match) {
      failures.push(`templates/github/${name} is missing STORY_VERSION`);
      continue;
    }
    expectEqual(failures, `templates/github/${name} STORY_VERSION`, packageVersion, match[1]);
  }
  return failures;
}

// setup-bun inputs that choose a Bun, as a block or flow mapping key, quoted
// or not, with or without a space before the colon.
const SETUP_BUN_KEY = /(?:^|[\s{,])(?:-\s+)?(["']?)(bun-version|bun-version-file|bun-download-url)\1[ \t]*:(?=\s|$)/g;
// A step that runs oven-sh/setup-bun, in block or flow style.
const SETUP_BUN_STEP = /(?:^|[\s{,])uses:\s*["']?oven-sh\/setup-bun(?:[@"'\s,}]|$)/;
// Bun's install script, which takes the version as a `bun-vX.Y.Z` argument.
const INSTALL_SCRIPT = /\bbun\.(?:sh|com)\/install/;

function withoutComment(line) {
  return line.replace(/(^|\s)#.*$/, "");
}

function indentOf(line) {
  return /^\s*/.exec(line)[0].length;
}

// The scalar after a key on line `index`: the text inside quotes, the rest of
// the line (up to the next `,` or `}` in a flow mapping), or, for an empty
// value or a block scalar (`>-`, `|`), the more indented lines below it.
function scalarValue(lines, index, rest, flow) {
  const text = rest.trimStart();
  const quoted = /^(["'])(.*?)\1/.exec(text);
  if (quoted) {
    return quoted[2];
  }
  const value = (flow ? text.split(/[,}]/)[0] : text).trim();
  if (value !== "" && !/^[>|][-+0-9]*$/.test(value)) {
    return value;
  }
  const below = [];
  for (let next = index + 1; next < lines.length; next += 1) {
    const line = withoutComment(lines[next]);
    if (line.trim() === "") {
      continue;
    }
    if (indentOf(line) <= indentOf(lines[index])) {
      break;
    }
    below.push(line.trim());
  }
  return below.join(" ");
}

// Which lines are inside a block scalar (`run: |`, `body: >-`). They hold
// text, such as a shell script, not keys.
function blockScalarLines(lines) {
  const inside = lines.map(() => false);
  let openedAt = null;
  lines.forEach((line, index) => {
    if (openedAt !== null && (line.trim() === "" || indentOf(line) > openedAt)) {
      inside[index] = true;
      return;
    }
    openedAt = /:[ \t]*[|>][-+0-9]*[ \t]*$/.test(withoutComment(line)) ? indentOf(line) : null;
  });
  return inside;
}

// The lines of the step that holds line `index`, from its `- ` item to the
// next key at or left of the dash.
function stepLines(lines, inside, index) {
  let start = index;
  if (!/^\s*-\s/.test(lines[index])) {
    while (start > 0 && (inside[start] || !/^\s*-\s/.test(lines[start]) || indentOf(lines[start]) >= indentOf(lines[index]))) {
      start -= 1;
    }
  }
  let end = start + 1;
  while (end < lines.length && (inside[end] || withoutComment(lines[end]).trim() === "" || indentOf(lines[end]) > indentOf(lines[start]))) {
    end += 1;
  }
  return lines.slice(start, end).filter((line, offset) => !inside[start + offset]);
}

// The committed fallback bundle only reproduces byte for byte on the pinned
// Bun, and publish.yml builds the release binaries, so every job in every
// workflow must install the version `packageManager` names. `workflows` maps
// each file name in .github/workflows to its text. Lines are read, not YAML:
// a Bun installed some other way (npm, a container image) is not seen.
//
// Each setup-bun step must name its version. Without one, setup-bun v2 reads
// packageManager only if package.json is already checked out when the step
// runs, and installs the latest Bun otherwise.
export function checkWorkflowBunPin(failures, packageManager, workflows) {
  const pinned = parsePinnedBunVersion(packageManager);
  if (!pinned) {
    failures.push(`package.json packageManager must pin an exact Bun version, got ${JSON.stringify(packageManager)}`);
    return failures;
  }

  let ciPins = 0;
  for (const [name, text] of Object.entries(workflows)) {
    const lines = text.split(/\r?\n/);
    const inside = blockScalarLines(lines);
    for (let index = 0; index < lines.length; index += 1) {
      const line = withoutComment(lines[index]);
      const where = `.github/workflows/${name}:${index + 1}`;
      if (!inside[index]) {
        for (const match of line.matchAll(SETUP_BUN_KEY)) {
          const key = match[2];
          if (key !== "bun-version") {
            failures.push(`${where} sets ${key}, which check:metadata cannot compare with the pin; use bun-version: ${pinned}`);
            continue;
          }
          ciPins += name === "ci.yml" ? 1 : 0;
          const flow = /\{[^}]*$/.test(line.slice(0, match.index + 1));
          const value = scalarValue(lines, index, line.slice(match.index + match[0].length), flow);
          expectEqual(failures, `${where} bun-version`, pinned, value);
        }
        const choosesBun = (stepLine) => new RegExp(SETUP_BUN_KEY.source).test(withoutComment(stepLine));
        if (SETUP_BUN_STEP.test(line) && !stepLines(lines, inside, index).some(choosesBun)) {
          failures.push(`${where} runs oven-sh/setup-bun without bun-version; add bun-version: ${pinned}`);
        }
      }
      if (!INSTALL_SCRIPT.test(line)) {
        continue;
      }
      const version = /\bbun-v(\S+?)["']?(?:\s|$)/.exec(line);
      if (!version) {
        failures.push(`${where} runs Bun's install script without bun-v${pinned}`);
        continue;
      }
      ciPins += name === "ci.yml" ? 1 : 0;
      expectEqual(failures, `${where} Bun install script`, pinned, version[1]);
    }
  }

  if (ciPins === 0) {
    failures.push(".github/workflows/ci.yml is missing bun-version");
  }
  return failures;
}

// Every workflow file in .github/workflows, keyed by file name. A folder or
// symlink named like a workflow is not one.
export function readWorkflows(root) {
  const dir = path.join(root, ".github", "workflows");
  return Object.fromEntries(
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")])
  );
}

// docs/development.md tells contributors which Bun to install, so it is the
// one place the pin is written out in prose. Keep it aligned with the pin.
export function checkDocBunPin(failures, packageManager, developmentDoc) {
  const pinned = parsePinnedBunVersion(packageManager);
  if (!pinned) {
    return failures;
  }

  const found = [...developmentDoc.matchAll(/`bun@(\d+\.\d+\.\d+)`/g)].map((match) => match[1]);
  if (found.length === 0) {
    failures.push(`docs/development.md must name the pinned Bun version as \`bun@${pinned}\``);
    return failures;
  }

  for (const version of new Set(found.filter((version) => version !== pinned))) {
    failures.push(`docs/development.md bun pin mismatch: expected ${pinned}, got ${version}`);
  }
  return failures;
}

export function checkDocVersions(failures, packageVersion, relativePaths, readFile) {
  for (const relativePath of relativePaths) {
    for (const { line, found } of staleDocVersions(readFile(relativePath), packageVersion)) {
      failures.push(`${relativePath}:${line} version example mismatch: expected ${packageVersion}, got ${found}`);
    }
  }
  return failures;
}

// The release script moves the Unreleased entries under the new version, so
// the released version must have its own section and compare link.
export function checkChangelogVersion(failures, packageVersion, changelog) {
  const escaped = packageVersion.replaceAll(".", "\\.");
  if (!/^## \[Unreleased\]/m.test(changelog)) {
    failures.push('CHANGELOG.md is missing the "## [Unreleased]" section');
  }
  if (!new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").test(changelog)) {
    failures.push(`CHANGELOG.md is missing a "## [${packageVersion}] - YYYY-MM-DD" section`);
  }
  if (!new RegExp(`^\\[${escaped}\\]: `, "m").test(changelog)) {
    failures.push(`CHANGELOG.md is missing the [${packageVersion}] link reference`);
  }
  return failures;
}

// Each changelog entry leads with one short sentence saying what changed for
// users, and the detail goes in indented sub-bullets, so a reader can scan the
// top-level list (#605). The lead is the entry's first paragraph: the bullet
// line and any lines that continue it, up to a sub-bullet or a blank line.
export const CHANGELOG_LEAD_LIMIT = 200;

const ENTRY = /^[-*+][ \t]/;
const LEAD_ENDS = /^(?:[ \t]+(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)| {0,3}#{1,6}(?:[ \t]|$)|[-*+][ \t]|\s*$)/;

export function checkChangelogEntries(failures, changelog) {
  const lines = changelog.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (!ENTRY.test(lines[index])) {
      continue;
    }
    const lead = [lines[index].slice(2).trim()];
    for (let next = index + 1; next < lines.length && !LEAD_ENDS.test(lines[next]); next++) {
      lead.push(lines[next].trim());
    }
    const length = shownLength(lead.join(" "));
    if (length > CHANGELOG_LEAD_LIMIT) {
      failures.push(
        `CHANGELOG.md:${index + 1} entry's lead is ${length} characters, over ${CHANGELOG_LEAD_LIMIT}: lead with one short sentence and move the detail into indented sub-bullets`
      );
    }
  }
  return failures;
}

// The characters a reader sees, with each inline link `[text](target)` shown
// as its text. A bracket inside a code span is not markup, link text may hold
// nested brackets, and a target may hold balanced parentheses. Every step is
// one pass over the text, so a line of unmatched brackets stays fast.
export function shownLength(text) {
  const size = text.length;
  // Code spans: a run of backticks closes at the next run of the same length.
  const runs = [];
  for (let i = 0; i < size; i++) {
    if (text[i] === "`") {
      const start = i;
      while (text[i + 1] === "`") {
        i++;
      }
      runs.push({ start, length: i - start + 1 });
    }
  }
  const closer = new Array(runs.length).fill(-1);
  const lastByLength = new Map();
  for (let k = runs.length - 1; k >= 0; k--) {
    closer[k] = lastByLength.get(runs[k].length) ?? -1;
    lastByLength.set(runs[k].length, k);
  }
  const codeEnd = new Int32Array(size + 1).fill(-1);
  for (let k = 0; k < runs.length; k++) {
    if (closer[k] >= 0) {
      const close = runs[closer[k]];
      codeEnd[runs[k].start] = close.start + close.length;
      k = closer[k];
    }
  }
  // Pair brackets and parentheses outside code spans, skipping escaped ones.
  const bracketClose = new Int32Array(size + 1).fill(-1);
  const parenClose = new Int32Array(size + 1).fill(-1);
  const brackets = [];
  const parens = [];
  for (let i = 0; i < size; i++) {
    if (codeEnd[i] >= 0) {
      i = codeEnd[i] - 1;
    } else if (text[i] === "\\") {
      i++;
    } else if (text[i] === "[") {
      brackets.push(i);
    } else if (text[i] === "]" && brackets.length > 0) {
      bracketClose[brackets.pop()] = i;
    } else if (text[i] === "(") {
      parens.push(i);
    } else if (text[i] === ")" && parens.length > 0) {
      parenClose[parens.pop()] = i;
    }
  }
  // Count, dropping each link's brackets and target.
  const skipTo = new Int32Array(size + 1).fill(-1);
  let shown = 0;
  for (let i = 0; i < size; ) {
    if (skipTo[i] >= 0) {
      i = skipTo[i];
    } else if (codeEnd[i] >= 0) {
      shown += codeEnd[i] - i;
      i = codeEnd[i];
    } else if (text[i] === "\\") {
      shown += Math.min(2, size - i);
      i += 2;
    } else if (text[i] === "[" && bracketClose[i] >= 0 && text[bracketClose[i] + 1] === "(" && parenClose[bracketClose[i] + 1] >= 0) {
      skipTo[bracketClose[i]] = parenClose[bracketClose[i] + 1] + 1;
      i++;
    } else {
      shown++;
      i++;
    }
  }
  return shown;
}

export function checkMarketplaces({ packageName, packageVersion, claudeMarketplace, agentsMarketplace, exists }) {
  const failures = [];

  if (!claudeMarketplace || typeof claudeMarketplace !== "object") {
    failures.push(".claude-plugin/marketplace.json is missing or is not an object");
  } else {
    expectEqual(failures, ".claude-plugin/marketplace.json name", packageName, claudeMarketplace.name);
    if (claudeMarketplace.version !== undefined) {
      expectEqual(failures, ".claude-plugin/marketplace.json version", packageVersion, claudeMarketplace.version);
    }
    const plugins = claudeMarketplace.plugins;
    if (!Array.isArray(plugins)) {
      failures.push(".claude-plugin/marketplace.json plugins must be an array");
    } else {
      if (!plugins.some((plugin) => plugin && plugin.name === packageName)) {
        failures.push(`.claude-plugin/marketplace.json has no plugin named ${packageName}`);
      }
      for (const plugin of plugins) {
        if (plugin && plugin.version !== undefined) {
          expectEqual(failures, `.claude-plugin/marketplace.json plugin ${plugin.name} version`, packageVersion, plugin.version);
        }
      }
    }
  }

  if (!agentsMarketplace || typeof agentsMarketplace !== "object") {
    failures.push(".agents/plugins/marketplace.json is missing or is not an object");
  } else {
    expectEqual(failures, ".agents/plugins/marketplace.json name", packageName, agentsMarketplace.name);
    if (agentsMarketplace.version !== undefined) {
      expectEqual(failures, ".agents/plugins/marketplace.json version", packageVersion, agentsMarketplace.version);
    }
    const plugins = agentsMarketplace.plugins;
    if (!Array.isArray(plugins)) {
      failures.push(".agents/plugins/marketplace.json plugins must be an array");
    } else {
      const entry = plugins.find((plugin) => plugin && plugin.name === packageName);
      if (!entry) {
        failures.push(`.agents/plugins/marketplace.json has no plugin named ${packageName}`);
      } else {
        expectEqual(
          failures,
          ".agents/plugins/marketplace.json plugin source.path",
          "./plugins/story-skills",
          entry.source && entry.source.path
        );
        if (entry.source && entry.source.path === "./plugins/story-skills" && !exists("./plugins/story-skills")) {
          failures.push(".agents/plugins/marketplace.json points at ./plugins/story-skills but that path does not exist");
        }
      }
      for (const plugin of plugins) {
        if (plugin && plugin.version !== undefined) {
          expectEqual(failures, `.agents/plugins/marketplace.json plugin ${plugin.name} version`, packageVersion, plugin.version);
        }
      }
    }
  }

  return failures;
}

// package.json `repository` as the plugin manifests write it: the https URL
// without npm's git+ prefix or the .git suffix.
export function repositoryUrl(repository) {
  const url = typeof repository === "string" ? repository : repository && repository.url;
  return typeof url === "string" ? url.replace(/^git\+/, "").replace(/\.git$/, "") : undefined;
}

// The plugin manifests describe the same plugin, so their descriptions must
// match, or one falls behind when a skill is added. Claude Code shows the
// Claude marketplace entry's description, homepage, and repository in place of
// plugin.json's, and before install it shows only the entry's for a plugin
// fetched by URL, so every entry for this plugin carries all three. The Codex
// `interface` text is written for the Codex UI and is not compared.
export function checkPluginManifests(failures, { packageJson, claudePlugin, codexPlugin, claudeMarketplace }) {
  const expected = { homepage: packageJson.homepage, repository: repositoryUrl(packageJson.repository) };
  for (const [field, value] of Object.entries(expected)) {
    if (typeof value !== "string" || value.trim() === "") {
      failures.push(`package.json is missing ${field}`);
    }
  }
  const description = claudePlugin.description;
  if (typeof description !== "string" || description.trim() === "") {
    failures.push(".claude-plugin/plugin.json is missing description");
  }

  const plugins = claudeMarketplace && Array.isArray(claudeMarketplace.plugins) ? claudeMarketplace.plugins : [];
  const copies = [
    [".codex-plugin/plugin.json", codexPlugin],
    ...plugins.flatMap((plugin, index) =>
      plugin && plugin.name === packageJson.name ? [[`.claude-plugin/marketplace.json plugins[${index}]`, plugin]] : []
    )
  ];
  for (const [label, manifest] of copies) {
    if (manifest.description !== description) {
      failures.push(`${label} description differs from .claude-plugin/plugin.json; give both the same text`);
    }
  }
  for (const [label, manifest] of [[".claude-plugin/plugin.json", claudePlugin], ...copies]) {
    for (const [field, value] of Object.entries(expected)) {
      expectEqual(failures, `${label} ${field}`, value, manifest[field]);
    }
  }
  return failures;
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

// Every metadata check against the checkout at `root`; returns the failures
// and the package.json it read.
export function metadataFailures(root = repoRoot) {
  const failures = [];

  const packageJson = readJson(root, "package.json");
  const codexPlugin = readJson(root, ".codex-plugin/plugin.json");
  const claudePlugin = readJson(root, ".claude-plugin/plugin.json");

  expectEqual(failures, "package.json name", packageJson.name, codexPlugin.name);
  expectEqual(failures, "package.json name", packageJson.name, claudePlugin.name);
  expectEqual(failures, "package/plugin version", packageJson.version, codexPlugin.version);
  expectEqual(failures, "package/plugin version", packageJson.version, claudePlugin.version);

  checkVersionModule(failures, packageJson.version, fs.readFileSync(path.join(root, "src", "version.js"), "utf8"));

  const claudeMarketplace = readJson(root, ".claude-plugin/marketplace.json");
  checkPluginManifests(failures, { packageJson, claudePlugin, codexPlugin, claudeMarketplace });

  if (codexPlugin.skills !== "./skills/") {
    failures.push(".codex-plugin/plugin.json skills must point to ./skills/");
  }

  checkSkillFrontmatter(failures, path.join(root, "skills"), (filePath) => fs.readFileSync(filePath, "utf8"));

  checkTemplateStoryVersion(failures, packageJson.version, path.join(root, "templates", "github"), (filePath) =>
    fs.readFileSync(filePath, "utf8")
  );

  checkWorkflowBunPin(failures, packageJson.packageManager, readWorkflows(root));

  checkDocBunPin(failures, packageJson.packageManager, fs.readFileSync(path.join(root, "docs", "development.md"), "utf8"));

  checkDocVersions(failures, packageJson.version, docVersionFiles(root), (relativePath) =>
    fs.readFileSync(path.join(root, relativePath), "utf8")
  );

  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  checkChangelogVersion(failures, packageJson.version, changelog);
  checkChangelogEntries(failures, changelog);

  const marketplaceFailures = checkMarketplaces({
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    claudeMarketplace,
    agentsMarketplace: readJson(root, ".agents/plugins/marketplace.json"),
    exists: (relativePath) => fs.existsSync(path.join(root, relativePath))
  });
  failures.push(...marketplaceFailures);
  return { failures, packageJson };
}

function main() {
  const { failures, packageJson } = metadataFailures();
  if (failures.length > 0) {
    console.error(`Metadata check failed:\n${failures.join("\n")}`);
    process.exit(1);
  }

  console.log(`Metadata is aligned for ${packageJson.name}@${packageJson.version}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

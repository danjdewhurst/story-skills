// story reindex, wordcount, and migrate, and fixProject, the safe repairs
// doctor --fix applies.
import fs from "node:fs";
import path from "node:path";
import { FRONTMATTER_PATTERN, parseFrontmatter, replaceFrontmatter } from "./frontmatter.js";
import { planChanges, projectPath, readTextFile, recordChanges, writeFile } from "./files.js";
import { chapterProse, characterCount, extractSection, maskMarkup, wordCount } from "./markdown.js";
import { EXIT_CODES, projectError } from "./exit-codes.js";
import { projectActions } from "./report.js";
import { undoInterruptedChange } from "./undo.js";
import {
  STORY_SCHEMA_VERSION,
  PROJECT_DIRECTORIES,
  MATTER_DIR,
  RESEARCH_DIR,
  deriveStoryId,
  scanProject,
  assertProjectParses,
  newerSchemaVersion,
  newerSchemaMessage,
  characterIndex,
  worldIndex,
  plotIndex,
  chapterIndex,
  timeline,
  sceneIndex,
  continuityState,
  questionIndex,
  promiseIndex,
  clueIndex,
  glossaryIndex,
  matterIndex,
  researchIndex,
  requireStoryFile,
  readMarkdown,
  safeRead
} from "./scan.js";
import { ensureDirectory, ensureFile, assertWritable, writeChanged } from "./mutate-writes.js";

export function reindexProject(root) {
  const project = scanProject(root);
  assertProjectParses(project, "reindex");
  const changed = [];
  const at = (...parts) => path.join(project.root, ...parts);
  const existingPlot = readRegistrySource(at("plot", "_index.md"), project.root);
  let plotStructure = "three-act";
  if (fs.existsSync(at("plot", "_index.md"))) {
    plotStructure = parseFrontmatter(existingPlot, "plot/_index.md").data.structure ?? "three-act";
  }

  writeRegistry(at("characters", "_index.md"), (existing) => characterIndex(
    project.storyId,
    project.characters,
    extractSection(existing, "Relationship Map"),
    extractSection(existing, "Family Trees")
  ), changed, project.root);
  writeRegistry(at("worldbuilding", "_index.md"), (existing) => worldIndex(
    project.storyId,
    project.locations,
    project.systems,
    project.factions,
    project.artifacts,
    extractSection(existing, "World Overview")
  ), changed, project.root);
  writeRegistry(at("plot", "_index.md"), (existing) => plotIndex(
    project.storyId,
    plotStructure,
    project.arcs,
    extractSection(existing, "Story Structure"),
    extractSection(existing, "Theme Tracking")
  ), changed, project.root);
  writeRegistry(at("chapters", "_index.md"), () => chapterIndex(project.storyId, project.chapters, project.unit), changed, project.root);
  writeRegistry(at("scenes", "_index.md"), () => sceneIndex(project.storyId, project.scenes), changed, project.root);
  writeRegistry(at("continuity", "questions", "_index.md"), () => questionIndex(project.storyId, project.questions), changed, project.root);
  writeRegistry(at("continuity", "promises", "_index.md"), () => promiseIndex(project.storyId, project.promises), changed, project.root);
  writeRegistry(at("continuity", "clues", "_index.md"), () => clueIndex(project.storyId, project.clues), changed, project.root);
  writeRegistry(at("glossary", "_index.md"), () => glossaryIndex(project.storyId, project.glossaryTerms), changed, project.root);
  if (fs.existsSync(at(MATTER_DIR))) {
    writeRegistry(at(MATTER_DIR, "_index.md"), () => matterIndex(project.storyId, project.matter), changed, project.root);
  }
  if (fs.existsSync(at(RESEARCH_DIR))) {
    writeRegistry(at(RESEARCH_DIR, "_index.md"), () => researchIndex(project.storyId, project.research), changed, project.root);
  }
  refreshStoryField(at("plot", "timeline.md"), project.storyId, changed, project.root);
  refreshStoryField(at("continuity", "state.md"), project.storyId, changed, project.root);

  return { changed };
}

function readRegistrySource(filePath, root) {
  return safeRead(filePath, root).replace(/\r\n/g, "\n");
}

// Regenerates a registry from its entity files. `build` receives the current
// registry (LF line endings) to carry over its hand-written sections; any
// other `## ` section the generator does not produce is appended unchanged,
// and a CRLF registry stays CRLF.
function writeRegistry(filePath, build, changed, root) {
  const raw = fs.existsSync(filePath) ? safeRead(filePath, root) : null;
  const existing = (raw ?? "").replace(/\r\n/g, "\n");
  const generated = build(existing);
  let contents = keepRegistryText(existing, generated, build);
  contents = keepRegistryFrontmatter(existing, contents);
  writeChanged(filePath, raw?.includes("\r\n") ? contents.replace(/\n/g, "\r\n") : contents, raw, changed, root);
}

// The generator owns only the frontmatter fields it writes; other fields and
// comment lines in the existing registry frontmatter are kept verbatim.
function keepRegistryFrontmatter(existing, contents) {
  let current;
  let next;
  try {
    current = parseFrontmatter(existing).data;
    next = parseFrontmatter(contents);
  } catch {
    return contents;
  }
  return replaceFrontmatter(existing, { ...current, ...next.data }, next.body);
}

// Generated value headings that replace each other: the chapter registry's
// total is in the book's count unit, so switching units must not keep the
// old total as a hand-written section.
const VALUE_HEADING_ALIASES = [["Total Word Count", "Total Character Count"]];

// The hand-written sections the generators carry over from the existing
// registry (see reindexProjectUnlocked), in lower case.
const CARRIED_SECTIONS = new Set(["relationship map", "family trees", "world overview", "story structure", "theme tracking"]);

// The generated registry with the existing registry's own text kept, so a
// reindex never drops a note. The generator owns its `## ` headings, the
// hand-written sections it carries over (kept as this split reads them, so
// a section above the title never takes the title with it), and its
// tables: every table with a generated header row (see
// registryTableLines) under the title, above it, or in a section it
// writes. Everything else stays where it was: the title line and the text
// under it, text above the title, and text before or after a generated
// table, `#` and `###` headings and other tables included. A `## ` section
// the generator does not write is appended after the generated ones.
// `build("")` gives the default text of an empty carried section.
function keepRegistryText(existing, generated, build) {
  // Headings match without regard to case, as extractSection reads them.
  // Only a generated heading that carries a value (`## Total Word Count:
  // 993`) is matched without it; every other heading must match in full, so
  // a hand-written `## Registry: 2` stays custom. Each generated heading
  // claims one existing section. A stale copy of a value heading (left by
  // 0.10.0) loses its heading, and its text joins the generated total.
  const valuePattern = /:\s*\d[\d,]*$/;
  const frontmatter = FRONTMATTER_PATTERN.exec(generated)[0];
  const fresh = registryParts(generated.slice(frontmatter.length));
  const freshTitle = fresh.sections.find((section) => section.title);
  const old = registryParts(existing.replace(FRONTMATTER_PATTERN, ""), freshTitle.text);
  const defaults = new Map(registryParts(build("").replace(FRONTMATTER_PATTERN, "")).sections.map((section) => [section.text.toLowerCase(), section.body]));
  const carried = (section) => section.level === 2 && CARRIED_SECTIONS.has(section.text.toLowerCase());
  const headers = fresh.sections.filter((section) => !carried(section)).map((section) => tableHeader(section.body)).filter((header) => header !== null);
  const valueKeys = new Map();
  const unclaimed = new Map();
  const kept = new Map();
  for (const section of fresh.sections) {
    kept.set(section, { body: carried(section) ? defaults.get(section.text.toLowerCase()) ?? section.body : section.body, before: [], after: [] });
    const text = section.text.toLowerCase();
    const hasValue = valuePattern.test(text);
    const key = hasValue ? text.replace(valuePattern, "") : text;
    if (hasValue) {
      const aliases = VALUE_HEADING_ALIASES.map((group) => group.map((alias) => alias.toLowerCase())).find((group) => group.includes(key)) ?? [key];
      aliases.forEach((alias) => valueKeys.set(alias, section));
    }
    if (section.level === 2) {
      unclaimed.set(key, [...(unclaimed.get(key) ?? []), section]);
    }
  }
  const custom = [];
  for (const section of old.sections) {
    const text = section.text.toLowerCase();
    const stripped = text.replace(valuePattern, "");
    const key = valueKeys.has(stripped) ? stripped : text;
    const target = section.title ? freshTitle : unclaimed.get(key)?.shift();
    if (target && carried(target)) {
      kept.get(target).body = section.body || kept.get(target).body;
    } else if (target || key !== text) {
      const { before, after } = withoutRegistryTables(section, headers);
      const place = kept.get(target ?? valueKeys.get(key));
      (target ? place.before : place.after).push(before);
      place.after.push(after);
    } else {
      custom.push(section.whole);
    }
  }
  const oldTitle = old.sections.find((section) => section.title);
  const preamble = withoutRegistryTables(old.preamble, headers);
  const blocks = fresh.sections.map((section) => {
    const { body, before, after } = kept.get(section);
    return [section.title && oldTitle ? oldTitle.heading : section.heading, ...before, body, ...after].filter((block) => block !== "").join("\n\n");
  });
  return `${frontmatter}\n${[preamble.before, preamble.after, ...blocks, ...custom].filter((block) => block !== "").join("\n\n")}\n`;
}

// A registry body split at its `## ` headings and its title: the first
// level 1 heading (`# ` or `===` underlined) reading `titleText`, else the
// first one. Any other level 1 heading belongs to the section it is in.
// Each part keeps its lines, and the same lines with comments and code
// fences masked, for withoutRegistryTables.
function registryParts(body, titleText) {
  const lines = body.split("\n");
  const masked = maskMarkup(body).split("\n");
  const headings = markdownHeadings(masked);
  const title = headings.find((heading) => heading.level === 1 && heading.text.toLowerCase() === titleText?.toLowerCase())
    ?? headings.find((heading) => heading.level === 1);
  const starts = headings.filter((heading) => heading.level === 2 || heading === title);
  const part = (from, to) => ({ body: linesText(lines, from, to), lines: lines.slice(from, to), masked: masked.slice(from, to) });
  return {
    preamble: part(0, starts[0]?.line ?? lines.length),
    sections: starts.map((heading, index) => {
      const end = starts[index + 1]?.line ?? lines.length;
      return {
        level: heading.level,
        text: heading.text,
        title: heading === title,
        heading: lines.slice(heading.line, heading.last + 1).join("\n"),
        whole: linesText(lines, heading.line, end),
        ...part(heading.last + 1, end)
      };
    })
  };
}

// Lines `from` to `to` without the blank lines around them.
function linesText(lines, from, to) {
  return lines.slice(from, to).join("\n").replace(/^(?:[ \t]*\n)+/, "").trimEnd();
}

// A part of a registry split around its registry tables: the text before
// the first, and the text after it with the others taken out.
function withoutRegistryTables(part, headers) {
  const { lines } = part;
  const owned = registryTableLines(lines, part.masked, headers);
  const first = lines.findIndex((line, index) => owned.has(index));
  if (first === -1) {
    return { before: "", after: part.body };
  }
  const gaps = [];
  for (let line = first; line < lines.length; line += 1) {
    if (owned.has(line)) {
      gaps.push([]);
    } else {
      gaps[gaps.length - 1].push(lines[line]);
    }
  }
  const after = gaps.map((gap) => linesText(gap, 0, gap.length)).filter((gap) => gap !== "");
  return { before: linesText(lines, 0, first), after: after.join("\n\n") };
}

// The table header row's cells at the start of a generated section, or null.
function tableHeader(body) {
  const lines = body.split("\n");
  return lines.length > 1 && isDelimiterRow(lines[1]) ? tableCells(lines[0]) : null;
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim().toLowerCase());
}

function isDelimiterRow(line) {
  return /^ {0,3}\|?[ \t:|-]*$/.test(line) && line.includes("-") && line.includes("|");
}

// The lines of the registry tables in `lines` (`masked` hides comments and
// fences): each table whose header row is one of `headers`, or differs
// from one in a single column name (`Word Count` that became `Character
// Count`), with or without its outer pipes. A table runs over the lines
// with a `|` after it; rows a blank line cut off, and a second registry
// table on the far side of a git conflict, belong to it, as do the
// conflict's markers when the conflict starts and ends among them. Any
// other table, such as one with a column added by hand, is left as text.
function registryTableLines(lines, masked, headers) {
  const blank = (index) => lines[index].trim() === "";
  const marker = (index) => /^(?:<{7}|={7}|>{7}|\|{7})(?:[ \t]|$)/.test(masked[index]);
  const piped = (index) => !blank(index) && !marker(index) && masked[index].includes("|");
  const starts = (index) => piped(index) && index + 1 < lines.length && isDelimiterRow(masked[index + 1]);
  const registry = (index) => starts(index) && headers.some((header) => sameHeader(tableCells(masked[index]), header));
  const runEnd = (index) => {
    let end = index + 1;
    while (end < lines.length && piped(end)) {
      end += 1;
    }
    return end;
  };
  const owned = new Set();
  let done = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!starts(index)) {
      continue;
    }
    let end = runEnd(index);
    if (!registry(index)) {
      index = end - 1;
      continue;
    }
    let first = index;
    for (let above = index - 1; above >= done && (blank(above) || marker(above)); above -= 1) {
      first = marker(above) ? above : first;
    }
    for (;;) {
      let next = end;
      while (next < lines.length && (blank(next) || marker(next))) {
        next += 1;
      }
      if (next === lines.length || !(registry(next) || (/^ {0,3}\|/.test(masked[next]) && piped(next) && !starts(next)))) {
        break;
      }
      end = runEnd(next);
    }
    let depth = 0;
    let balanced = true;
    for (let line = first; line < lines.length && (line < end || (depth > 0 && (blank(line) || marker(line)))); line += 1) {
      if (marker(line)) {
        depth += { "<": 1, ">": -1 }[masked[line][0]] ?? 0;
        balanced &&= depth >= 0 && (depth > 0 || masked[line][0] !== "=" && masked[line][0] !== "|");
        end = Math.max(end, line + 1);
      }
    }
    for (let line = first; line < end; line += 1) {
      if (!marker(line) || (balanced && depth === 0)) {
        owned.add(line);
      }
    }
    done = end;
    index = end - 1;
  }
  return owned;
}

function sameHeader(cells, header) {
  return cells.length === header.length && cells.filter((cell, index) => cell !== header[index]).length <= 1;
}

// Level 1 and 2 headings in masked lines, with their first and last line
// numbers and their text, found as extractSection finds them: ATX headings
// with up to three spaces of indent and no closing run of `#`, none inside
// a closed code fence or an HTML comment. A paragraph underlined with `=`
// is a level 1 heading too, but not above the `=======` between the two
// sides of a git conflict.
function markdownHeadings(lines) {
  const atx = (line) => /^ {0,3}(#{1,6})(?=[ \t]|$)/.exec(line);
  let conflict = false;
  const underline = (line) => /^ {0,3}=+[ \t]*$/.test(line) && !(conflict && /^={7}[ \t]*$/.test(line));
  const headings = [];
  let paragraph = null;
  for (const [index, line] of lines.entries()) {
    conflict = /^<{7}(?:[ \t]|$)/.test(line) || (conflict && !/^>{7}(?:[ \t]|$)/.test(line));
    const heading = atx(line);
    if (heading && heading[1].length <= 2) {
      headings.push({ level: heading[1].length, text: headingText(line.slice(heading[0].length)), line: index, last: index });
    } else if (paragraph !== null && underline(line)) {
      headings.push({ level: 1, text: lines.slice(paragraph, index).map((text) => text.trim()).join(" "), line: paragraph, last: index });
    }
    const prose = line.trim() !== "" && !heading && !underline(line) && !/^ {0,3}\|/.test(line);
    paragraph = prose ? paragraph ?? index : null;
  }
  return headings;
}

// An ATX heading's text without its closing run of `#`.
function headingText(rest) {
  const text = rest.trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") {
    end -= 1;
  }
  return end === 0 || text[end - 1] === " " || text[end - 1] === "\t" ? text.slice(0, end).trim() : text;
}

function refreshStoryField(filePath, storyId, changed, root) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  let raw;
  try {
    raw = readTextFile(filePath);
  } catch {
    return;
  }
  let parsed;
  try {
    parsed = parseFrontmatter(raw, filePath);
  } catch {
    return;
  }
  if (parsed.data.story === storyId) {
    return;
  }
  writeChanged(filePath, replaceFrontmatter(raw, {
    ...parsed.data,
    story: storyId
  }), raw, changed, root);
}

export function computeWordCounts(root, options = {}) {
  const project = scanProject(root);
  assertProjectParses(project, "count words");
  const characters = project.unit.name === "characters";
  const chapters = [];
  // A chapter whose recorded count is out of date is rewritten by --write.
  const needsCount = (chapter) => chapter.declaredWordCount !== chapter.wordCount || chapter.declaredCount !== chapter.count;
  // Every chapter --write rewrites is checked first, and so is each registry
  // the reindex after them rewrites (a planned run writes nothing), so a
  // read-only file stops the command before any chapter changes.
  if (options.write) {
    assertWritable(project.root, project.chapters.filter(needsCount).map((chapter) => chapter.file));
    planChanges(project.root, () => reindexProject(project.root));
  }

  for (const chapter of project.chapters) {
    chapters.push({
      number: chapter.number,
      title: chapter.title,
      file: projectPath(project.root, chapter.file),
      wordCount: chapter.wordCount,
      ...(characters ? { characterCount: chapter.count } : {})
    });

    // A project counted in characters records character-count beside
    // word-count.
    if (options.write && needsCount(chapter)) {
      const markdown = readMarkdown(chapter.file, project.root);
      const prose = chapterProse(markdown.body);
      // An editor saving the chapter meanwhile keeps its save.
      writeFile(chapter.file, replaceFrontmatter(markdown.rawMarkdown, {
        ...markdown.data,
        "word-count": wordCount(prose),
        ...(characters ? { "character-count": characterCount(prose) } : {})
      }), { root: project.root, unchangedFrom: markdown.rawMarkdown });
    }
  }

  if (options.write) {
    reindexProject(project.root);
  }

  // `total` is in the count unit: a book counted in characters says so with
  // `unit`, and its chapters carry characterCount.
  return {
    ...(characters ? { unit: "characters" } : {}),
    chapters,
    total: chapters.reduce((sum, chapter) => sum + (characters ? chapter.characterCount : chapter.wordCount), 0)
  };
}

export function migrateProject(root) {
  const projectRoot = path.resolve(root);
  const storyPath = requireStoryFile(projectRoot);
  // Scan first, so an unparseable story.md is reported by name like any other
  // file that stops migrate.
  assertProjectParses(scanProject(projectRoot), "migrate");
  const story = readMarkdown(storyPath, projectRoot);
  const newerVersion = newerSchemaVersion(story.data["schema-version"]);
  if (newerVersion !== null) {
    throw projectError(newerSchemaMessage(newerVersion));
  }
  const storyId = deriveStoryId(story.data.title, projectRoot);
  const upgrading = story.data["schema-version"] !== STORY_SCHEMA_VERSION;
  const changed = [];

  // Entity folders start empty and git does not keep empty folders, so a
  // clone of a current project lacks some. validate does not require them
  // and add makes the one it writes into, so only an upgrade restores them.
  for (const directory of upgrading ? PROJECT_DIRECTORIES : []) {
    ensureDirectory(path.join(projectRoot, directory), changed, projectRoot);
  }

  ensureFile(path.join(projectRoot, "plot", "timeline.md"), timeline(storyId), changed, projectRoot);
  ensureFile(path.join(projectRoot, "scenes", "_index.md"), sceneIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "state.md"), continuityState(storyId), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "questions", "_index.md"), questionIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "clues", "_index.md"), clueIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "glossary", "_index.md"), glossaryIndex(storyId, []), changed, projectRoot);

  if (upgrading) {
    writeFile(storyPath, replaceFrontmatter(story.rawMarkdown, {
      ...story.data,
      "schema-version": STORY_SCHEMA_VERSION
    }), { root: projectRoot, unchangedFrom: story.rawMarkdown });
    changed.push(storyPath);
  }

  const reindexed = reindexProject(projectRoot);
  return { root: projectRoot, changed: changed.concat(reindexed.changed) };
}

// The repairs `story doctor --fix` applies, in order. Each runs only when
// the diagnosis raised one of its codes (a warning story.md severity turned
// off is not raised), rewrites only registries and frontmatter the CLI
// maintains, never prose, and changes nothing when run again. migrate only
// adds missing folders and starter files and sets schema-version, so it is
// safe; it and wordcount --write both reindex when they finish, so reindex
// runs on its own only when neither did.
const DOCTOR_REPAIRS = [
  { command: "migrate", codes: ["schema-version-mismatch", "missing-required-path"], run: (root) => migrateProject(root) },
  { command: "wordcount --write", codes: ["stale-word-count"], run: (root) => computeWordCounts(root, { write: true }) },
  { command: "reindex", codes: ["stale-registry", "story-id-mismatch"], run: (root) => reindexProject(root) }
];

// story doctor --fix: diagnoses the project, applies the safe repairs the
// findings call for, and diagnoses it again, all under the project lock
// runCli holds, so the report is what remains for the writer to do.
// Returns that second diagnosis (see projectActions) with `repairs`, one {
// command, codes, changes } per repair run, and `stopped`, the message of
// the error that stopped a repair (a file that does not parse), after
// which none of the later ones is tried; null when every due repair ran.
// A change a split, merge, move, rename, or remove left part way is put
// back first (command `undo`), needing no file to parse, and the other
// repairs are chosen from the project it puts back.
export function fixProject(root, options = {}) {
  let before = projectActions(root, options);
  const repairs = [];
  let stopped = null;
  if (raisedCodes(before).has("interrupted-change")) {
    stopped = runRepair(root, { command: "undo", codes: ["interrupted-change"], run: undoInterruptedChange }, repairs);
    before = projectActions(root, options);
  }
  const raised = raisedCodes(before);
  const due = DOCTOR_REPAIRS
    .map((repair) => ({ ...repair, codes: repair.codes.filter((code) => raised.has(code)) }))
    .filter((repair) => repair.codes.length > 0);
  try {
    if (stopped === null && due.length > 0) {
      assertRepairable(root);
    }
  } catch (error) {
    stopped = projectErrorMessage(error);
  }
  for (const repair of stopped === null ? due : []) {
    if (repair.command === "reindex" && repairs.some((entry) => entry.command !== "undo")) {
      continue;
    }
    stopped = runRepair(root, repair, repairs);
    if (stopped !== null) {
      break;
    }
  }
  const after = repairs.length > 0 ? projectActions(root, options) : before;
  return { ...after, repairs, stopped };
}

// The codes a diagnosis raised: errors and warnings that story.md
// severity did not turn off.
function raisedCodes(report) {
  return new Set([...report.validation.errors, ...report.validation.warnings].map((finding) => finding.code));
}

// Runs one repair, adding it to `repairs` with its changes, which are kept
// even when it stops part way, so the report lists every file written.
// Returns the message of the project error that stopped it, or null. Any
// other error (a refused write) is rethrown with `repairs` on it, so
// doctor --fix can still list the repairs made before it (see runDoctorFix).
function runRepair(root, repair, repairs) {
  const { result: error, changes } = recordChanges(root, () => {
    try {
      repair.run(root);
      return null;
    } catch (caught) {
      return caught;
    }
  });
  if (error === null || changes.length > 0) {
    repairs.push({ command: repair.command, codes: repair.codes, changes });
  }
  if (error !== null && typeof error === "object" && error.exitCode !== EXIT_CODES.project) {
    error.repairs = repairs;
  }
  return error === null ? null : projectErrorMessage(error);
}

// Every repair ends in a reindex, which needs each entity file and the plot
// registry to parse. Checking them first means a repair does not stop on
// one after it has already written.
function assertRepairable(root) {
  const project = scanProject(root);
  assertProjectParses(project, "fix");
  const plotPath = path.join(project.root, "plot", "_index.md");
  if (fs.existsSync(plotPath)) {
    const label = "plot/_index.md";
    const source = readRegistrySource(plotPath, project.root);
    try {
      parseFrontmatter(source, label);
    } catch (error) {
      const message = String(error?.message);
      throw projectError(`Cannot fix: fix this file first (story validate reports it):\n- ${message.startsWith(label) ? message : `${label}: ${message}`}`);
    }
  }
}

// A project error (a file that does not parse) stops the repairs and is
// reported; any other error (a refused write, a lock) stops the command.
function projectErrorMessage(error) {
  if (error?.exitCode !== EXIT_CODES.project) {
    throw error;
  }
  return error.message;
}

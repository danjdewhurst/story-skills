// story impact: what a proposed change would break. The change runs on a
// scratch copy of the project (previewChanges, the copy --dry-run uses), with
// story check run on that copy before and after it, and only the findings
// the change adds or clears are reported. The project itself is only read:
// its lock is not taken, and the change, its undo log, and its reindex are
// all written in the copy.
import { readTextFile, writeFile } from "./files.js";
import { warn } from "./findings.js";
import { parseFrontmatter, replaceFrontmatter } from "./frontmatter.js";
import { usageError } from "./exit-codes.js";
import { escapeRegExp } from "./markdown.js";
import { chapterChronology } from "./chronology.js";
import { idText } from "./continuity.js";
import { sortProgressions } from "./progressions.js";
import { reindexProject } from "./mutate-maintenance.js";
import { existingChapter } from "./mutate-restructure.js";
import { previewChanges } from "./preview.js";
import { projectCheck } from "./report.js";
import { assertProjectParses, relative, requireKebabId, scanProject } from "./scan.js";

// Runs `change(copyRoot)` on a copy of the project at `root`, between two
// runs of story check on that copy, and returns what changed: the change's
// own result and warnings, the files it changed (relative to the project),
// each finding the change added, cleared, or carried over, by severity and
// with its check, and the counts before and after. Both checks read the same
// copy, so a finding the copy alone would raise is in both and cancels out.
// Each check reads the story.md severity and exemptions of the copy as it is
// then (`overridesAt`), so an exemption the change rewrites (move follows a
// renumbered chapter there) applies after it as in the real run. `strict`
// makes an added warning fail the run as an added error does, as check
// --strict fails on warnings.
export function projectImpact(root, change, { overridesAt, strict = false }) {
  const { result, changes } = previewChanges(root, (copyRoot) => {
    const before = projectCheck(copyRoot, { overrides: overridesAt(copyRoot) });
    const outcome = change(copyRoot);
    const after = projectCheck(copyRoot, { overrides: overridesAt(copyRoot) });
    return { outcome, before, after };
  });
  const { outcome, before, after } = result;
  const added = { errors: [], warnings: [] };
  const cleared = { errors: [], warnings: [] };
  const carried = { errors: [], warnings: [] };
  const carry = carriedText(outcome);
  for (const severity of ["errors", "warnings"]) {
    const was = taggedFindings(before, severity);
    const now = taggedFindings(after, severity);
    // Each cleared finding pairs with at most one added finding of the
    // same carried text.
    const gone = difference(was, now);
    const waiting = new Map();
    for (const finding of carry === null ? [] : gone) {
      const key = carriedKey(finding, carry);
      if (waiting.has(key)) {
        waiting.get(key).push(finding);
      } else {
        waiting.set(key, [finding]);
      }
    }
    const paired = new Set();
    for (const finding of difference(now, was)) {
      const match = carry === null ? undefined : waiting.get(carriedKey(finding, carry))?.shift();
      if (match === undefined) {
        added[severity].push(finding);
      } else {
        paired.add(match);
        carried[severity].push(finding);
      }
    }
    cleared[severity] = gone.filter((finding) => !paired.has(finding));
  }
  return {
    root: before.root,
    ok: added.errors.length === 0 && (!strict || added.warnings.length === 0),
    strict,
    outcome,
    changes,
    added,
    cleared,
    carried,
    before: counts(before),
    after: counts(after)
  };
}

// A check result's findings of one severity, each with the check that
// reported it, as story check --json names it.
function taggedFindings(result, severity) {
  return Object.entries(result.findings).flatMap(([check, found]) => found[severity].map((finding) => ({ ...finding, check })));
}

// The findings in `list` that `other` lacks. story check reports each
// finding once (see uniqueCheckFindings), so a set is enough.
function difference(list, other) {
  const keys = new Set(other.map(findingKey));
  return list.filter((finding) => !keys.has(findingKey(finding)));
}

function findingKey(finding) {
  return [finding.check, finding.code, finding.file ?? "", finding.chapter ?? "", finding.message].join("\n");
}

// A finding the project already had, which the change only gave new ids,
// such as a posthumous appearance in a chapter that a merge renumbered, is
// carried over rather than added and cleared. carriedText(outcome) maps a
// finding's text to one that leaves out what the change renamed: the old id
// becomes the new one (rename, move), and when chapters were renumbered
// (move, split, merge) every chapter and scene id is the same placeholder.
// null when the change renamed nothing.
function carriedText(outcome) {
  const steps = [];
  if (typeof outcome.oldId === "string" && typeof outcome.id === "string" && outcome.oldId !== outcome.id) {
    const old = new RegExp(`(?<![\\p{L}\\p{N}-])${escapeRegExp(outcome.oldId)}(?![\\p{L}\\p{N}-])`, "gu");
    steps.push((text) => text.replace(old, outcome.id));
  }
  if (outcome.renumbered !== undefined || (["chapter", "scene"].includes(outcome.kind) && typeof outcome.oldId === "string")) {
    steps.push((text) => text.replace(CHAPTER_IDS, "chapter-#"));
  }
  return steps.length === 0 ? null : (text) => steps.reduce((value, step) => step(value), text);
}

const CHAPTER_IDS = /(?<![\p{L}\p{N}-])chapter-\d+(?:-scene-\d+)?(?![\p{L}\p{N}-])/gu;

function carriedKey(finding, carry) {
  return [finding.check, finding.code, carry(finding.file ?? ""), carry(finding.message)].join("\n");
}

function counts(result) {
  return { errors: result.errors.length, warnings: result.warnings.length, dismissed: result.dismissed.length };
}

// The frontmatter that records a death in `chapter`, as
// character-management records one: died-in and status deceased; for a
// character already dead and revived before that chapter, a status
// progression to deceased from it, which continuity reads as a second death,
// with died-in and revived-in kept. A death at or before a revival moves the
// first death, and the revival still sets the status. A death in an outline
// chapter is planned, so the status stays until the chapter is drafted.
function deathFields(project, data, chapter) {
  const died = idText(data["died-in"]);
  const revived = idText(data["revived-in"]);
  const status = chapter.status === "outline" ? {} : { status: "deceased" };
  if (revived === "") {
    return { "died-in": chapter.id, ...status };
  }
  const chronology = chapterChronology(project);
  if (died === "" || !chronology.after(chapter.id, revived)) {
    return { "died-in": chapter.id };
  }
  const list = Array.isArray(data.progressions) ? data.progressions : [];
  return { progressions: sortProgressions([...list, { from: chapter.id, field: "status", value: "deceased" }], chronology), ...status };
}

// story impact die: the character dies in a chapter. Sets the character's
// died-in to the chapter (a second death after a revival: see deathFields)
// and status to deceased, as continuity asks of a
// written death (death-status-mismatch), and reindexes, so the registry's
// status column follows. Only story impact runs it, on its copy, so it keeps
// no undo log. A death in an outline chapter is planned: the status stays as
// it is until the chapter is drafted, and continuity checks no cast against
// the death until then, so that is said (planned-death).
export function markDeath(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "test a death");
  const id = String(options.id ?? "").trim();
  if (!id) {
    throw usageError("impact die requires a character id and a chapter id: story impact die <character-id> <chapter-id>");
  }
  requireKebabId(id, "character id");
  const character = project.characters.find((entry) => entry.id === id);
  if (!character) {
    throw usageError(`character ${id} does not exist`);
  }
  const chapter = existingChapter(project, options.chapter, "impact die requires a chapter id: story impact die <character-id> <chapter-id>");
  const text = readTextFile(character.file);
  const { data } = parseFrontmatter(text, character.file);
  // A planned death keeps the status the drafted chapters give the
  // character, as character-management records one.
  const next = { ...data, ...deathFields(project, data, chapter) };
  const changed = [];
  if (JSON.stringify(next) !== JSON.stringify(data)) {
    writeFile(character.file, replaceFrontmatter(text, next), { root: project.root });
    changed.push(character.file, ...reindexProject(project.root).changed);
  }
  const warnings = chapter.status === "outline"
    ? [warn("planned-death", `${relative(project, chapter.file)} is an outline chapter, so continuity treats a death there as planned and checks no later cast against it until the chapter is drafted`, relative(project, chapter.file))]
    : [];
  return { kind: "character", id, chapter: chapter.id, file: character.file, changed, warnings };
}

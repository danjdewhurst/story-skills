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
import { reindexProject } from "./mutate-maintenance.js";
import { existingChapter } from "./mutate-restructure.js";
import { previewChanges } from "./preview.js";
import { projectCheck } from "./report.js";
import { assertProjectParses, relative, requireKebabId, scanProject } from "./scan.js";

// Runs `change(copyRoot)` on a copy of the project at `root`, between two
// runs of story check on that copy, and returns what changed: the change's
// own result and warnings, the files it changed (relative to the project),
// each finding the change added or cleared, by severity and with its check,
// and the counts before and after. Both checks read the same copy, so a
// finding the copy alone would raise is in both and cancels out. `strict`
// makes an added warning fail the run as an added error does, as check
// --strict fails on warnings.
export function projectImpact(root, change, { overrides, strict = false } = {}) {
  const { result, changes } = previewChanges(root, (copyRoot) => {
    const before = projectCheck(copyRoot, { overrides });
    const outcome = change(copyRoot);
    const after = projectCheck(copyRoot, { overrides });
    return { outcome, before, after };
  });
  const { outcome, before, after } = result;
  const added = { errors: [], warnings: [] };
  const cleared = { errors: [], warnings: [] };
  for (const severity of ["errors", "warnings"]) {
    const was = taggedFindings(before, severity);
    const now = taggedFindings(after, severity);
    added[severity] = difference(now, was);
    cleared[severity] = difference(was, now);
  }
  return {
    root: before.root,
    ok: added.errors.length === 0 && (!strict || added.warnings.length === 0),
    strict,
    outcome,
    changes,
    added,
    cleared,
    before: counts(before),
    after: counts(after)
  };
}

// A check result's findings of one severity, each with the check that
// reported it, as story check --json names it.
function taggedFindings(result, severity) {
  return Object.entries(result.findings).flatMap(([check, found]) => found[severity].map((finding) => ({ ...finding, check })));
}

// The findings in `list` that `other` lacks, counting repeats, so a finding
// raised twice after a change and once before is added once.
function difference(list, other) {
  const left = new Map();
  for (const finding of other) {
    const key = findingKey(finding);
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  return list.filter((finding) => {
    const key = findingKey(finding);
    const count = left.get(key) ?? 0;
    if (count > 0) {
      left.set(key, count - 1);
      return false;
    }
    return true;
  });
}

function findingKey(finding) {
  return [finding.check, finding.code, finding.file ?? "", finding.chapter ?? "", finding.message].join("\n");
}

function counts(result) {
  return { errors: result.errors.length, warnings: result.warnings.length, dismissed: result.dismissed.length };
}

// story impact die: the character dies in a chapter. Sets the character's
// died-in to the chapter and status to deceased, as continuity asks of a
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
  const planned = chapter.status === "outline";
  const next = planned ? { ...data, "died-in": chapter.id } : { ...data, "died-in": chapter.id, status: "deceased" };
  const changed = [];
  if (data["died-in"] !== next["died-in"] || data.status !== next.status) {
    writeFile(character.file, replaceFrontmatter(text, next), { root: project.root });
    changed.push(character.file, ...reindexProject(project.root).changed);
  }
  const warnings = planned
    ? [warn("planned-death", `${relative(project, chapter.file)} is an outline chapter, so continuity treats a death there as planned and checks no later cast against it until the chapter is drafted`, relative(project, chapter.file))]
    : [];
  return { kind: "character", id, chapter: chapter.id, file: character.file, changed, warnings };
}

// story move: a chapter or scene renumbered, with its references and
// headings following it.
import fs from "node:fs";
import path from "node:path";
import { chapterChronology, renumberedChronology } from "./chronology.js";
import { PROGRESSION_KINDS, sortProgressions } from "./progressions.js";
import { parseFrontmatter, replaceFrontmatter } from "./frontmatter.js";
import { projectPath, readTextFile } from "./files.js";
import { maskMarkup } from "./markdown.js";
import { refusedError, usageError } from "./exit-codes.js";
import {
  scanProject,
  assertProjectParses,
  entityConfig,
  KIND_ALIASES,
  requireKebabId,
  requirePositiveInteger,
  nextSceneNumber,
  readMarkdown
} from "./scan.js";
import { withUndo, flag, commitMoves, interruptedMove } from "./mutate-writes.js";
import {
  followExemptionPatterns,
  followQueryFilters,
  adoptedReferenceWarnings,
  idRenamer,
  renameIdTokens,
  entityReferenceContext,
  renameLinkTargets,
  planReferenceRewrites,
  applyEntityBacklinks
} from "./mutate-references.js";
import { reindexProject } from "./mutate-maintenance.js";

// Moves a chapter to another number, or a scene to another chapter or
// position. Chapter and scene ids encode their numbers, so a move renames the
// files and rewrites every reference: scene `chapter` fields, promise, clue,
// question, and research chapters, died-in, continuity state, links, and
// bare ids in plot/timeline.md and arc files. References are written first
// and the moved files last, so an interrupted move can be rerun.
export function moveEntity(root, options) {
  return withUndo(root, ["move", options.kind, options.id, ...flag("number", options.number), ...flag("chapter", options.chapter), ...flag("scene", options.scene)], () => {
    const project = scanProject(root);
    assertProjectParses(project, "move");
    const kind = normalizeMoveKind(options.kind);
    const id = String(options.id ?? "").trim();
    if (!id) {
      throw usageError("move requires a chapter or scene id");
    }
    requireKebabId(id, `${kind} id`);
    return kind === "chapter" ? moveChapter(project, id, options) : moveScene(project, id, options);
  });
}

// Plural labels for the kinds move refuses.
const KIND_PLURALS = {
  character: "characters", location: "locations", system: "systems", faction: "factions", artifact: "artifacts",
  arc: "arcs", question: "questions", promise: "promises", clue: "clues", term: "glossary terms",
  matter: "matter pages", research: "research notes"
};

function normalizeMoveKind(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "") {
    throw usageError("An entity kind is required: expected one of chapter, scene");
  }
  if (!Object.hasOwn(KIND_ALIASES, text)) {
    throw usageError(`Unsupported entity kind: ${value}: expected one of chapter, scene`);
  }
  const kind = KIND_ALIASES[text];
  if (kind !== "chapter" && kind !== "scene") {
    throw usageError(`story move works on chapters and scenes, not ${KIND_PLURALS[kind]}; use story rename to change other ids`);
  }
  return kind;
}

// `action` names the command for the adopted-references warning: split and
// merge renumber chapters through here too.
export function moveChapter(project, oldId, options, action = "move") {
  const chapter = project.chapters.find((entry) => entry.id === oldId);
  if (!chapter) {
    throw usageError(`chapter ${oldId} does not exist`);
  }
  if (options.number === undefined) {
    throw usageError("move chapter requires --number <n>");
  }
  const number = requirePositiveInteger(options.number, "chapter number");
  const newId = `chapter-${String(number).padStart(2, "0")}`;
  const newFile = path.join(project.root, "chapters", `${newId}.md`);
  if (newId === oldId) {
    throw usageError(`${oldId} is already chapter ${number}`);
  }
  const taken = project.chapters.find((entry) => entry.number === number && entry.id !== oldId);

  const markdown = readMarkdown(chapter.file, project.root);
  const renumbered = replaceFrontmatter(markdown.rawMarkdown, { ...markdown.data, number }, renumberedHeading(markdown.body, number));
  const scenes = project.scenes.filter((scene) => scene.chapter === oldId);
  const sceneMoves = scenes.map((scene) => ({
    oldFile: scene.file,
    newFile: path.join(project.root, "scenes", `${newId}-scene-${String(scene.scene).padStart(2, "0")}.md`)
  }));
  const context = entityReferenceContext(project.root, "chapter", oldId);
  // Links to the chapter's scene files follow the scenes too.
  const sceneContexts = scenes.map((scene) => ({ context: entityReferenceContext(project.root, "scene", scene.id), newId: `${newId}-scene-${String(scene.scene).padStart(2, "0")}` }));
  const plan = planReferenceRewrites(project.root, context, new Map([[chapter.file, renumbered]]),
    idRenamer(oldId, newId),
    (body, file) => renameIdTokens(project.root, file, sceneContexts.reduce(
      (text, entry) => renameLinkTargets(project.root, file, text, entry.context, entry.newId),
      renameLinkTargets(project.root, file, body, context, newId)
    ), oldId, newId));
  plan.originals.set(chapter.file, markdown.rawMarkdown);
  // current-chapter is a number: follow the chapter it pointed at.
  const statePath = path.join(project.root, "continuity", "state.md");
  if (fs.existsSync(statePath)) {
    const stateText = plan.get(statePath) ?? readTextFile(statePath);
    const stateData = parseFrontmatter(stateText, statePath).data;
    if (stateData["current-chapter"] === chapter.number) {
      if (!plan.has(statePath)) {
        plan.originals.set(statePath, stateText);
      }
      plan.set(statePath, replaceFrontmatter(stateText, { ...stateData, "current-chapter": number }));
    }
  }
  followExemptionPatterns(project.root, plan, "chapter", oldId, newId);
  followQueryFilters(project.root, plan, "chapter", oldId, newId);
  reorderProgressions(project, plan, renumberedChronology(chapterChronology(project), oldId, newId, number));
  const moves = [{ oldFile: chapter.file, newFile }, ...sceneMoves];
  // The number is taken, unless an earlier run of this move was interrupted
  // after writing the chapter there.
  if (taken && !interruptedMove(plan, moves)) {
    throw refusedError(`${newId} already exists: move it first. To make room, renumber from the highest chapter down`);
  }
  const warnings = taken ? [] : adoptedReferenceWarnings(project.root, "chapter", newId, chapter.file, action);
  commitMoves(project.root, plan, moves);
  const reindexed = reindexProject(project.root);
  return { kind: "chapter", oldId, id: newId, file: newFile, moved: moves.length, changed: moves.map((move) => move.newFile).concat(reindexed.changed), warnings };
}

// A level-1 ATX heading line, found in masked text.
const LEVEL_ONE_HEADING = /^[ \t]{0,3}#(?!#)[ \t]+[^\r\n]*(?:\r?\n|$)/gm;

// A heading line that reads `# Chapter N`, with or without a title after a
// colon; the number is the second group.
export const CHAPTER_NUMBER_HEADING = /^([ \t]{0,3}#[ \t]+Chapter[ \t]+)(\d+)(?=[ \t]*(?::|\r?\n|$))/;

// The level-1 headings of a body that a comment or code fence does not
// hide, each with its line as written.
export function levelOneHeadings(body, masked, limit = masked.length) {
  return [...masked.slice(0, limit).matchAll(LEVEL_ONE_HEADING)].map((match) => ({ index: match.index, end: match.index + match[0].length, line: body.slice(match.index, match.index + match[0].length) }));
}

// The chapter body with its heading renumbered: the body's first level-1
// heading that reads `# Chapter N`. One in a comment or code fence never
// counts, and the frontmatter is never touched, so a `# Chapter 1: ...`
// comment line there keeps its number, as does a later heading in the text.
function renumberedHeading(body, number) {
  const heading = levelOneHeadings(body, maskMarkup(body)).find((entry) => CHAPTER_NUMBER_HEADING.test(entry.line));
  if (heading === undefined) {
    return body;
  }
  return `${body.slice(0, heading.index)}${body.slice(heading.index).replace(CHAPTER_NUMBER_HEADING, `$1${number}`)}`;
}

// A renumbered chapter can move past another progression's chapter, so the
// progressions of every character, location, and faction the move rewrote
// are put back in story order, which validate requires.
export function reorderProgressions(project, plan, chronology) {
  const dirs = PROGRESSION_KINDS.map((kind) => entityConfig(kind).dir);
  for (const [file, text] of plan) {
    if (!dirs.includes(projectPath(project.root, path.dirname(file)))) {
      continue;
    }
    const data = parseFrontmatter(text, file).data;
    if (!Array.isArray(data.progressions)) {
      continue;
    }
    const sorted = sortProgressions(data.progressions, chronology);
    if (sorted.some((item, index) => item !== data.progressions[index])) {
      plan.set(file, replaceFrontmatter(text, { ...data, progressions: sorted }));
    }
  }
}

export function moveScene(project, oldId, options, action = "move") {
  const scene = project.scenes.find((entry) => entry.id === oldId);
  if (!scene) {
    throw usageError(`scene ${oldId} does not exist`);
  }
  if (options.chapter === undefined && options.scene === undefined) {
    throw usageError("move scene requires --chapter <id>, --scene <n>, or both");
  }
  const chapterId = String(options.chapter ?? scene.chapter).trim();
  requireKebabId(chapterId, "chapter id");
  if (!project.chapters.some((entry) => entry.id === chapterId)) {
    throw usageError(`chapter ${chapterId} does not exist`);
  }
  const markdown = readMarkdown(scene.file, project.root);
  const context = entityReferenceContext(project.root, "scene", oldId);
  const planMove = (number) => {
    const newId = `${chapterId}-scene-${String(number).padStart(2, "0")}`;
    const moved = replaceFrontmatter(markdown.rawMarkdown, { ...markdown.data, chapter: chapterId, scene: number });
    // No frontmatter field names a scene, so only links and bare ids change.
    const plan = planReferenceRewrites(project.root, context, new Map([[scene.file, moved]]),
      idRenamer(oldId, newId),
      (body, file) => renameIdTokens(project.root, file, renameLinkTargets(project.root, file, body, context, newId), oldId, newId));
    plan.originals.set(scene.file, markdown.rawMarkdown);
    followExemptionPatterns(project.root, plan, "scene", oldId, newId);
    return { number, newId, plan, moves: [{ oldFile: scene.file, newFile: path.join(project.root, "scenes", `${newId}.md`) }] };
  };
  let target;
  if (options.scene === undefined) {
    // Without --scene, a rerun of an interrupted move finds the copy the
    // earlier run wrote instead of moving the scene again to the next free
    // number.
    target = project.scenes
      .filter((entry) => entry.chapter === chapterId && entry.id !== oldId && entry.title === scene.title)
      .map((entry) => planMove(entry.scene))
      .find((candidate) => interruptedMove(candidate.plan, candidate.moves));
  }
  // Without --scene a scene keeps its number in its own chapter and goes to
  // the end of another one.
  target ??= planMove(options.scene !== undefined ? requirePositiveInteger(options.scene, "scene number")
    : chapterId === scene.chapter ? scene.scene : nextSceneNumber(project, chapterId));
  const { number, newId, plan, moves } = target;
  const newFile = moves[0].newFile;
  if (newId === oldId) {
    throw usageError(`${oldId} is already scene ${number} of ${chapterId}`);
  }
  if (project.scenes.some((entry) => entry.id === newId) && !interruptedMove(plan, moves)) {
    throw refusedError(`${newId} already exists: move it first`);
  }
  const warnings = project.scenes.some((entry) => entry.id === newId) ? [] : adoptedReferenceWarnings(project.root, "scene", newId, scene.file, action);
  // The chapter gains the scene's cast before the old scene is deleted, so a
  // move interrupted at that step can still be rerun.
  commitMoves(project.root, plan, moves, () => applyEntityBacklinks(project.root, "scene", newId, readMarkdown(newFile, project.root).data),
    [path.join(project.root, "chapters", `${chapterId}.md`)]);
  const reindexed = reindexProject(project.root);
  return { kind: "scene", oldId, id: newId, file: newFile, moved: 1, changed: [newFile].concat(reindexed.changed), warnings };
}

// story split: one chapter made two at a scene break or paragraph.
import path from "node:path";
import { replaceFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { projectPath, writeFile } from "./files.js";
import { chapterHeading } from "./markdown.js";
import { warn } from "./findings.js";
import { refusedError, usageError } from "./exit-codes.js";
import {
  scanProject,
  assertProjectParses,
  canonicalChapterId,
  requireSingleLineName,
  chapterChoices,
  CONTINUE_CHOICE,
  readMarkdown,
  asArray,
  relative
} from "./scan.js";
import { withUndo, flag } from "./mutate-writes.js";
import {
  adoptedReferenceFiles,
  abandonedThreadFiles,
  abandonedThreadWarnings,
  idRenamer,
  ID_TOKEN_REGISTRIES,
  renameIdTokens,
  renameChapterIdText,
  entityReferenceContext,
  renameLinkTargets,
  planReferenceRewrites,
  REGISTRY_FILES
} from "./mutate-references.js";
import { reindexProject } from "./mutate-maintenance.js";
import { moveScene } from "./mutate-move.js";
import {
  restructureWrites,
  existingChapter,
  bookChoices,
  listedItems,
  refuseUnsafeBranching,
  retargetedChoices,
  followingRun,
  shiftChapters,
  chapterRunFiles,
  chapterLengthFields,
  withLineEndings,
  proseParagraphs,
  assertRestructurable,
  setCurrentChapter
} from "./mutate-restructure.js";

// A split gives one chapter a number no chapter has: the last chapter of
// the run it renumbers moves to the number after the run, or, when no
// chapter follows, the new chapter takes the next number. A file may
// already name that id: a payoff scheduled for a chapter not written yet,
// say. Those references were planned for another chapter, and once they
// named this one a later merge would carry them back with it. A split
// cannot tell what they mean, so it refuses, and the writer points them at
// the chapter they mean first. Every file counts, the renumbered chapter's
// own included, but only the chapter id: a scene id under it is left to the
// adopted-references warning of the move. An abandoned thread may keep the
// id a new chapter takes, as add chapter allows, so it only warns
// (abandonedThreadWarnings). A choice that leads to the id is named by its
// index, since the chapter would take over where it leads, and a chapter
// file that also names the id elsewhere (a link in its text) says so.
function refuseSplitAdoption(project, chapter, run) {
  const last = run.at(-1);
  const number = (last ?? chapter).number + 1;
  const target = canonicalChapterId(number);
  const abandoned = new Set(last === undefined ? abandonedThreadFiles(project, target) : []);
  // Registries are left out, since reindex rewrites them, but not the ids
  // written in the timeline and the plot registry's tables.
  const files = adoptedReferenceFiles(project.root, "chapter", target, null, renameChapterIdText)
    .filter((file) => (!REGISTRY_FILES.has(file) || ID_TOKEN_REGISTRIES.has(file)) && !abandoned.has(file));
  if (files.length === 0) {
    return;
  }
  const leading = new Map();
  for (const choice of bookChoices(project)) {
    if (choice.to === target) {
      const file = relative(project, choice.chapter.file);
      if (!leading.has(file)) {
        leading.set(file, []);
      }
      leading.get(file).push(`${file} choices[${choice.index}]`);
    }
  }
  const elsewhere = new Set(leading.size === 0 ? [] : adoptedReferenceFiles(project.root, "chapter", target, null, renameChapterIdText, withoutChoices));
  const named = files.flatMap((file) => (leading.has(file) ? [...leading.get(file), ...(elsewhere.has(file) ? [`other references in ${file}`] : [])] : [file]));
  const [it, them, means, belongs] = named.length === 1 ? ["it", "it", "it means", "it belongs"] : ["they", "them", "they mean", "they belong"];
  const change = last === undefined
    ? `this split would give that id to its new chapter, the rest of ${chapter.id}`
    : `this split would renumber ${last.id} to ${target}`;
  const keep = last === undefined
    ? `${chapter.id} if ${belongs} in the text that moves (then point ${them} at ${target} after the split)`
    : `${last.id} if ${belongs} there (the split then carries ${them} to ${target})`;
  throw refusedError(`${listedItems(named)} ${named.length === 1 ? "names" : "name"} ${target}, which has no file yet, and ${change}, so ${it} would point at that chapter. Point ${them} at the chapter ${means} first: ${keep}, or ${canonicalChapterId(number + 1)} for the chapter after it; nothing was changed`);
}

// Where `--at` splits a chapter body. A number is a scene break, counted from
// 1, and the break itself is dropped. Any other marker names a line of the
// prose: first a line whose text, without heading hashes, is exactly the
// marker, else the one line that contains it; the split falls at the start of
// its paragraph, dropping a scene break just before it. Returns the offset
// the first chapter ends at (`cut`), where the second starts (`start`), how
// many scene breaks come before the split, and whether it falls on one.
function splitPoint(body, marker, chapterId, headerLines) {
  const paragraphs = proseParagraphs(body);
  const breaks = paragraphs.filter((paragraph) => paragraph.sceneBreak);
  let index;
  if (/^\d+$/.test(marker)) {
    const number = Number(marker);
    if (number < 1 || number > breaks.length) {
      throw usageError(breaks.length === 0
        ? `chapter ${chapterId} has no scene breaks in its chapter text: pass --at with a heading or a line of the text instead`
        : `--at ${marker}: chapter ${chapterId} has ${breaks.length} scene ${breaks.length === 1 ? "break" : "breaks"}, so give a number from 1 to ${breaks.length}, or a heading or a line of the text`);
    }
    index = paragraphs.indexOf(breaks[number - 1]) + 1;
  } else {
    const lines = paragraphs.filter((paragraph) => !paragraph.sceneBreak).flatMap((paragraph) => paragraph.lines.map((entry) => ({ ...entry, paragraph })));
    const plain = (text) => text.trim().replace(/^#{1,6}[ \t]+/, "").replace(/[ \t]+#+$/, "").trim();
    let matches = lines.filter((entry) => plain(entry.text) === marker);
    if (matches.length === 0) {
      matches = lines.filter((entry) => entry.text.includes(marker));
    }
    if (matches.length === 0) {
      throw usageError(`--at "${marker}" matches no line in the chapter text of ${chapterId}: give a scene break number, a heading, or a line of the text`);
    }
    if (matches.length > 1) {
      throw usageError(`--at "${marker}" matches ${matches.length} lines in ${chapterId} (lines ${matches.map((entry) => entry.line + headerLines + 1).join(", ")}): quote more of the line so it matches only one`);
    }
    index = paragraphs.indexOf(matches[0].paragraph);
  }
  return splitAt(paragraphs, index, marker, chapterId);
}

// The split before paragraph `index` (see splitPoint), which also locates
// it again after the renumbering has rewritten links in the chapter.
function splitAt(paragraphs, index, marker, chapterId) {
  const breaks = paragraphs.filter((paragraph) => paragraph.sceneBreak);
  const before = paragraphs.slice(0, index);
  const after = paragraphs.slice(index);
  const atBreak = before.length > 0 && before.at(-1).sceneBreak;
  if (!before.some((paragraph) => !paragraph.sceneBreak)) {
    throw usageError(`--at "${marker}" is at the start of the chapter text of ${chapterId}, so nothing would stay in it: split at a later point`);
  }
  if (!after.some((paragraph) => !paragraph.sceneBreak)) {
    throw usageError(`--at "${marker}" is at the end of the chapter text of ${chapterId}, so the new chapter would be empty: split at an earlier point`);
  }
  return {
    index,
    cut: atBreak ? before.at(-1).start : after[0].start,
    start: after[0].start,
    breaksBefore: before.filter((paragraph) => paragraph.sceneBreak).length,
    atBreak,
    sections: breaks.length + 1
  };
}

// A chapter's reference context without the `to` of choices.
function withoutChoices(context) {
  return { ...context, isReferenceKey: (key, listKey) => key !== "to" && context.isReferenceKey(key, listKey) };
}

// The files besides `excluded` that name `chapterId` in a reference field, a
// link to its file, or a bare id in the timeline and arc bodies. Registries
// are left out, since reindex rewrites them, and so are choices: one that
// leads to the chapter leads to its start, which stays in it.
function chapterReferenceFiles(root, chapterId, excluded) {
  const context = withoutChoices(entityReferenceContext(root, "chapter", chapterId));
  const probe = `${chapterId}-reference-probe`;
  // Only the chapter id itself: its scene ids follow their scenes.
  const plan = planReferenceRewrites(root, context, new Map(excluded.map((file) => [file, null])), idRenamer(chapterId, probe),
    (body, file) => renameIdTokens(root, file, renameLinkTargets(root, file, body, context, probe), chapterId, probe, renameChapterIdText));
  return [...plan.keys()].map((file) => projectPath(root, file)).filter((file) => !REGISTRY_FILES.has(file)).sort();
}

// Chapter fields the new chapter of a split copies from the one it came
// from, the story's own `author` among them, so both halves keep its
// byline. Its hook goes with it too, since the new chapter now ends where the
// old one did; arcs-advanced stays behind, since the arc beat could be in
// either half.
const SPLIT_COPIED_FIELDS = ["numbered", "author", "pov", "locations", "characters", "mentions", "status", "mode", "date", "time", "strand"];

export function splitChapter(root, options) {
  return withUndo(root, ["split", options.id, ...flag("at", options.at), ...flag("title", options.title)], () => splitNow(root, options));
}

function splitNow(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "split");
  const chapter = existingChapter(project, options.id, "split requires a chapter id");
  const marker = options.at === undefined || options.at === true ? "" : String(options.at).trim();
  if (marker === "") {
    throw usageError("split requires --at <marker>: a scene break number, a heading, or a line of the chapter text");
  }
  let title = `${chapter.title} (continued)`;
  if (options.title !== undefined) {
    title = options.title === true ? "" : String(options.title).trim();
    if (title === "") {
      throw usageError("--title cannot be empty: leave it out to use the chapter's title with (continued)");
    }
    requireSingleLineName(title, "chapter", "title");
  }
  const choices = refuseUnsafeBranching(project, "split", [chapter]);

  const original = readMarkdown(chapter.file, project.root);
  const headerLines = original.rawMarkdown.slice(0, original.rawMarkdown.length - original.body.length).split("\n").length - 1;
  const point = splitPoint(original.body, marker, chapter.id, headerLines);
  const number = chapter.number + 1;
  const newId = canonicalChapterId(number);
  const newFile = path.join(project.root, "chapters", `${newId}.md`);
  const run = followingRun(project, number);
  // In a branching book a chapter with no choices is an ending, so the
  // first half gets one choice, leading on to the rest: without it the
  // reader would stop there, and no choice would lead to the new chapter.
  // A book whose only choices are malformed is linear to the branch
  // checks, so it gets none.
  const added = project.chapters.some((entry) => chapterChoices(entry, "").choices.length > 0) ? { file: relative(project, chapter.file), index: 0, text: CONTINUE_CHOICE, to: newId } : null;

  // Scene records have no place in the text, so they follow it in order: the
  // records of the scenes before the split stay, the rest move.
  const scenes = project.scenes.filter((scene) => scene.chapter === chapter.id).sort((left, right) => left.scene - right.scene);
  const keep = point.atBreak ? point.breaksBefore : point.breaksBefore + 1;
  const moving = scenes.slice(keep);
  const label = relative(project, chapter.file);
  const warnings = [];
  if (scenes.length > 0 && scenes.length !== point.sections) {
    warnings.push(warn("split-scenes", `${label} has ${scenes.length} scene ${scenes.length === 1 ? "record" : "records"} but ${point.sections} ${point.sections === 1 ? "scene" : "scenes"} of text between scene breaks, so split kept the first ${Math.min(keep, scenes.length)} in ${chapter.id} and moved ${moving.length === 0 ? "none" : moving.map((scene) => scene.id).join(", ")} to ${newId} by order. Check them, and fix any with story move scene`, label));
  } else if (!point.atBreak && scenes[keep - 1] !== undefined) {
    warnings.push(warn("split-scenes", `--at "${marker}" falls inside the text of ${scenes[keep - 1].id}, whose record stays in ${chapter.id}; if the scene now belongs to ${newId}, or needs a record in each, use story move scene and story add scene`, label));
  }
  // With no chapter after it, the new half takes a number no chapter had.
  if (run.length === 0) {
    warnings.push(...abandonedThreadWarnings(project, newId));
  }
  const referencing = chapterReferenceFiles(project.root, chapter.id, [chapter.file, ...scenes.map((scene) => scene.file)]);
  if (referencing.length > 0) {
    warnings.push(warn("split-references", `${referencing.join(", ")} still ${referencing.length === 1 ? "names" : "name"} ${chapter.id}, which now holds only the text before the split: check whether ${referencing.length === 1 ? "it" : "any of them"} should name ${newId} instead`, referencing.length === 1 ? referencing[0] : null));
  }
  const runIds = new Set(run.map((entry) => entry.id));
  const chapterTargets = [newFile, ...run.map((entry) => path.join(project.root, "chapters", `${canonicalChapterId(entry.number + 1)}.md`))];
  assertRestructurable(project, {
    chapters: [chapter.id, ...runIds],
    scenes: [...moving, ...project.scenes.filter((scene) => runIds.has(scene.chapter))].map((scene) => scene.id),
    changed: [chapter.file, ...chapterRunFiles(project, run), ...moving.map((scene) => scene.file)],
    created: [...chapterTargets, ...moving.map((scene, index) => path.join(project.root, "scenes", `${newId}-scene-${String(index + 1).padStart(2, "0")}.md`))],
    chapterTargets
  });
  refuseSplitAdoption(project, chapter, run);
  // A character who dies in the chapter cannot be in the cast of a later
  // one, so the new chapter only mentions them; split-references lists the
  // death to check.
  const dead = new Set(project.characters.filter((character) => character.diedIn === chapter.id).map((character) => character.id));

  restructureWrites(project.root, () => {
    shiftChapters(project.root, run, 1, warnings, "split");
    // The renumbering can rewrite link targets in the chapter, which moves
    // offsets but never paragraphs, so split what it holds now at the same
    // paragraph.
    const current = scanProject(project.root);
    const markdown = readMarkdown(chapter.file, project.root);
    const split = splitAt(proseParagraphs(markdown.body), point.index, marker, chapter.id);
    const firstBody = withLineEndings(`${markdown.body.slice(0, split.cut).trimEnd()}\n`, markdown.rawMarkdown);
    const secondProse = `${markdown.body.slice(split.start).trimEnd()}\n`;
    const { hook, ...kept } = markdown.data;
    const copied = Object.fromEntries(SPLIT_COPIED_FIELDS.filter((key) => Object.hasOwn(markdown.data, key)).map((key) => [key, markdown.data[key]]));
    const departed = asArray(copied.characters).filter((id) => dead.has(id));
    if (departed.length > 0) {
      copied.characters = asArray(copied.characters).filter((id) => !dead.has(id));
      copied.mentions = [...new Set([...asArray(copied.mentions), ...departed])];
    }
    // An unnumbered chapter (a prologue) is headed by its title alone.
    const secondBody = `# ${markdown.data.numbered === false ? title : chapterHeading(number, title)}\n\n## Chapter Text\n\n${secondProse}`;
    const secondData = {
      title,
      number,
      ...copied,
      "arcs-advanced": [],
      ...(hook === undefined ? {} : { hook }),
      ...chapterLengthFields(secondBody, current.unit)
    };
    writeFile(newFile, withLineEndings(`${stringifyFrontmatter(secondData)}${secondBody}`, markdown.rawMarkdown), { root: project.root, unchangedFrom: null });
    const leadOn = added === null ? {} : { choices: [{ text: added.text, to: added.to }] };
    writeFile(chapter.file, replaceFrontmatter(markdown.rawMarkdown, { ...kept, ...leadOn, ...chapterLengthFields(firstBody, current.unit) }, firstBody),
      { root: project.root, unchangedFrom: markdown.rawMarkdown });
    // The latest drafted chapter is now the second half.
    setCurrentChapter(project.root, chapter.number, number);
    for (const [index, scene] of moving.entries()) {
      warnings.push(...moveScene(scanProject(project.root), scene.id, { chapter: newId, scene: String(index + 1) }, "split").warnings);
    }
  });
  const reindexed = reindexProject(project.root);
  return {
    kind: "chapter",
    id: chapter.id,
    newId,
    title,
    file: newFile,
    scenesMoved: moving.length,
    renumbered: run.length,
    choiceAdded: added,
    choicesRetargeted: retargetedChoices(project, choices, run, 1),
    changed: [chapter.file, newFile].concat(reindexed.changed),
    warnings
  };
}

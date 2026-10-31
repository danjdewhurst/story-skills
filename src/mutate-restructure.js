// The checks and helpers story split and story merge share.
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, replaceFrontmatter } from "./frontmatter.js";
import { readTextFile, recordChanges, writeFile } from "./files.js";
import {
  breaksParagraph,
  chapterProse,
  characterCount,
  isSceneBreakLine,
  maskMarkup,
  proseStart,
  wordCount
} from "./markdown.js";
import { EXEMPTIONS_FILE } from "./exemptions.js";
import { refusedError, usageError } from "./exit-codes.js";
import { scanProject, canonicalChapterId, requireKebabId, relative } from "./scan.js";
import { assertWritable } from "./mutate-writes.js";
import {
  idRenamer,
  renameIdTokens,
  entityReferenceContext,
  renameLinkTargets,
  planReferenceRewrites,
  REGISTRY_FILES
} from "./mutate-references.js";
import { moveChapter } from "./mutate-move.js";

// story split and story merge restructure chapters with the machinery move
// uses: the chapters after the change are renumbered with moveChapter, scene
// records follow their text with moveScene, and references to a merged
// chapter are rewritten as move rewrites them. Every check runs before the
// first write. A split or merge is several steps, so one stopped part way
// is not finished where it stopped: its undo log stays (see withUndo), and a
// rerun puts back what it changed and starts again.
const RESTRUCTURE_HINT = "Some files were already changed: fix the problem and run the same command again, which puts them back and starts over, or run story doctor --fix to put them back";

// Runs the writes of a split or merge. When a step fails after earlier ones
// wrote, the error says so in place of any rerun hint the step gave, unless
// the error is marked `resumable` (a merge that put its last step back),
// whose hint says what a rerun does with the change. The checks before it
// leave little that can fail (a full disk, a file saved meanwhile), so it is
// exported for tests.
export function restructureWrites(root, write) {
  const { result: error, changes } = recordChanges(root, () => {
    try {
      write();
      return null;
    } catch (caught) {
      return caught;
    }
  });
  if (error !== null) {
    if (changes.length > 0 && !error.resumable) {
      error.hint = RESTRUCTURE_HINT;
    }
    throw error;
  }
}

export function existingChapter(project, value, missing) {
  const id = String(value ?? "").trim();
  if (!id) {
    throw usageError(missing);
  }
  requireKebabId(id, "chapter id");
  const chapter = project.chapters.find((entry) => entry.id === id);
  if (!chapter) {
    throw usageError(`chapter ${id} does not exist`);
  }
  return chapter;
}

// A chapter's `choices` entries as written, malformed ones included: only
// a missing field or an empty list means no choices, and any other value
// that is not a list (null, "", a word) is one malformed entry.
function choiceEntries(chapter) {
  return chapter.choices === undefined ? [] : Array.isArray(chapter.choices) ? chapter.choices : [chapter.choices];
}

// Every choice entry in the book, malformed ones included, each with its
// chapter, its index, and its `to` and `text` when they are text, else
// null: a renumbering rewrites the `to` of a list entry that names a
// renumbered chapter, whether or not the rest of the entry is valid.
export function bookChoices(project) {
  return project.chapters.flatMap((chapter) => choiceEntries(chapter).map((entry, index) => ({
    chapter,
    index,
    to: Array.isArray(chapter.choices) && typeof entry?.to === "string" ? entry.to : null,
    text: typeof entry?.text === "string" ? entry.text : null
  })));
}

// A choice as a refusal names it: its file and index.
function choiceLabel(project, chapter, index) {
  return `${relative(project, chapter.file)} choices[${index}]`;
}

// The items a refusal lists, the first few of them when there are many, so
// a book with thousands of choices still gets a message one can read.
const LISTED_ITEMS = 10;

export function listedItems(items) {
  return items.length <= LISTED_ITEMS ? items.join(", ") : `${items.slice(0, LISTED_ITEMS).join(", ")}, and ${items.length - LISTED_ITEMS} more`;
}

// Frontmatter text in a message, with control characters shown as U+FFFD
// so none reaches the terminal.
function shownText(text) {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "\ufffd");
}

// In a branching book a chapter's place comes from the choices that lead to
// it, and its own choices end it. A split or merge there is safe only when
// it changes where no choice leads and what text a choice ends: the
// chapters it splits or joins have no choices, and no choice leads to
// `folded`, the chapter a merge folds into the one before, since a reader
// who took it would land at the start of that one instead. A malformed
// choice counts in both, since the renumbering rewrites its `to` all the
// same. The renumbering rewrites every other `to`, as move does. Returns
// the book's choices: none in a linear book.
export function refuseUnsafeBranching(project, command, chapters, folded = null) {
  const choices = bookChoices(project);
  if (choices.length === 0) {
    return choices;
  }
  const own = choices.filter((choice) => chapters.includes(choice.chapter))
    .map((choice) => `${choiceLabel(project, choice.chapter, choice.index)}${choice.to === null ? "" : ` (to ${shownText(choice.to)})`}`);
  if (own.length > 0) {
    throw refusedError(`story ${command} works on a branching book only when ${command === "split" ? "the chapter it splits has" : "the chapters it merges have"} no choices, since a chapter's choices end it and a ${command} would change the passage they end: ${listedItems(own)}. Restructure the book by hand with story add chapter, story move, and story remove`);
  }
  const leading = choices.filter((choice) => choice.to === folded?.id).map((choice) => choiceLabel(project, choice.chapter, choice.index));
  if (leading.length > 0) {
    const [it, leads] = leading.length === 1 ? ["it", "leads"] : ["them", "lead"];
    throw refusedError(`story merge works on a branching book only when no choice leads to the chapter it folds into the one before, since a reader who took it would land at the start of ${chapters[0].id} instead: ${listedItems(leading)} ${leads} to ${folded.id}. Point ${it} at another chapter first, or restructure the book by hand with story add chapter, story move, and story remove`);
  }
  return choices;
}

// The choices whose `to` the renumbering of `run` by `step` rewrites, as
// { file, index, text, from, to }: each in its chapter's file after the
// renumbering, for the split or merge to list. `text` is null for a choice
// with none.
export function retargetedChoices(project, choices, run, step) {
  const renumbered = new Map(run.map((entry) => [entry.id, canonicalChapterId(entry.number + step)]));
  return choices.filter((choice) => renumbered.has(choice.to)).map((choice) => ({
    file: renumbered.has(choice.chapter.id) ? `chapters/${renumbered.get(choice.chapter.id)}.md` : relative(project, choice.chapter.file),
    index: choice.index,
    text: choice.text,
    from: choice.to,
    to: renumbered.get(choice.to)
  }));
}

// The chapters numbered `number`, `number + 1`, and so on up to the first
// gap: the run a split or merge renumbers by one. A gap stops it, so the
// rest of the book keeps its numbers.
export function followingRun(project, number) {
  const run = [];
  const numbered = (next) => project.chapters.filter((entry) => entry.number === next);
  for (let chapters = numbered(number); chapters.length > 0; chapters = numbered(number + run.length)) {
    if (chapters.length > 1) {
      throw refusedError(`${chapters.map((chapter) => relative(project, chapter.file)).join(" and ")} share chapter number ${chapters[0].number}: give each its own number first (story validate reports it)`);
    }
    run.push(chapters[0]);
  }
  return run;
}

// Renumbers each chapter of `run` by `step` with move chapter: from the
// highest down when making room, from the lowest up when closing a gap, so
// no number is ever taken twice. `action` is the command, split or merge.
export function shiftChapters(root, run, step, warnings, action) {
  for (const chapter of step > 0 ? [...run].reverse() : run) {
    const result = moveChapter(scanProject(root), chapter.id, { number: String(chapter.number + step) }, action);
    warnings.push(...result.warnings);
  }
}

// The files a run of chapters and their scenes occupies.
export function chapterRunFiles(project, run) {
  const ids = new Set(run.map((chapter) => chapter.id));
  return [...run.map((chapter) => chapter.file), ...project.scenes.filter((scene) => ids.has(scene.chapter)).map((scene) => scene.file)];
}

// The length frontmatter for a chapter body: word-count, and character-count
// in a book counted in characters.
export function chapterLengthFields(body, unit) {
  const prose = chapterProse(body);
  return { "word-count": wordCount(prose), ...(unit.name === "characters" ? { "character-count": characterCount(prose) } : {}) };
}

// A file's own line ending for text the command generates.
export function withLineEndings(text, sample) {
  return sample.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text;
}

// The paragraphs of a chapter's prose: runs of lines that are not blank once
// comments and code fences are masked, so a scene break or a marker inside
// either never counts, and each scene-break line on its own, as builds read
// one even with text right above or below it (see breaksParagraph). Each
// has its offsets in the body, its first line's index in the body, its
// masked lines, and whether it is a scene break.
export function proseParagraphs(body) {
  const masked = maskMarkup(body);
  const start = proseStart(body, masked);
  const paragraphs = [];
  let offset = 0;
  let line = 0;
  let current = null;
  for (const text of masked.split("\n")) {
    const lineStart = offset;
    offset += text.length + 1;
    if (lineStart >= start && text.trim() !== "" && breaksParagraph(text)) {
      if (current) {
        paragraphs.push(current);
      }
      paragraphs.push({ start: lineStart, line, lines: [{ text, line }], end: lineStart + text.length });
      current = null;
    } else if (lineStart >= start && text.trim() !== "") {
      current ??= { start: lineStart, line, lines: [] };
      current.lines.push({ text, line });
      current.end = lineStart + text.length;
    } else if (current) {
      paragraphs.push(current);
      current = null;
    }
    line += 1;
  }
  if (current) {
    paragraphs.push(current);
  }
  for (const paragraph of paragraphs) {
    paragraph.sceneBreak = isSceneBreakLine(paragraph.lines.map((entry) => entry.text).join("\n"));
  }
  return paragraphs;
}

// Every file a rename of these chapter or scene ids rewrites: the reference
// fields, links, and bare ids move rewrites.
function rewrittenFiles(root, kind, ids) {
  const files = new Set();
  for (const id of ids) {
    const context = entityReferenceContext(root, kind, id);
    const probe = `${id}-restructure-probe`;
    const plan = planReferenceRewrites(root, context, new Map(), idRenamer(id, probe),
      (body, file) => renameIdTokens(root, file, renameLinkTargets(root, file, body, context, probe), id, probe));
    plan.forEach((text, file) => files.add(file));
  }
  return [...files];
}

// The checks a split or merge runs before its first write, since a step
// that fails after an earlier one wrote cannot be finished by a rerun:
// every file a step rewrites (the references to each renamed chapter and
// scene, continuity/state.md, the exemptions log, and the registries) must
// be writable, the files it creates must not exist (`chapterTargets`, the
// chapter files the renumbering writes, unless a chapter that moves away
// holds one now), and every scene file of the chapters involved must be
// named for its chapter and scene fields, or the renumbering could collide
// with it part way.
export function assertRestructurable(project, { chapters, scenes, changed, created, chapterTargets }) {
  const root = project.root;
  const vacated = new Set(project.chapters.filter((chapter) => chapters.includes(chapter.id)).map((chapter) => chapter.file));
  const occupied = chapterTargets.find((file) => fs.existsSync(file) && !vacated.has(file));
  if (occupied) {
    throw refusedError(`${relative(project, occupied)} already exists and is not a chapter this command renumbers: fix it first (story validate reports it)`);
  }
  const ids = new Set([...chapters, ...chapterTargets.map((file) => path.basename(file, ".md"))]);
  for (const scene of project.scenes) {
    const named = /^(.+)-scene-\d+$/.exec(scene.id)?.[1];
    const expected = `${scene.chapter}-scene-${String(scene.scene).padStart(2, "0")}`;
    if (named !== undefined && (ids.has(scene.chapter) || ids.has(named)) && scene.id !== expected) {
      throw refusedError(`${relative(project, scene.file)} is scene ${scene.scene} of ${scene.chapter} by its frontmatter but not by its file name, so renumbering could collide with it: rename it to scenes/${expected}.md, or fix its chapter and scene fields, first`);
    }
  }
  const fixed = [path.join("continuity", "state.md"), EXEMPTIONS_FILE, ...REGISTRY_FILES].map((file) => path.join(root, file));
  assertWritable(root, [...changed, ...rewrittenFiles(root, "chapter", chapters), ...rewrittenFiles(root, "scene", scenes), ...fixed], created);
}

// Sets continuity/state.md current-chapter to `to` when it holds `from`.
export function setCurrentChapter(root, from, to, plan = null) {
  const statePath = path.join(root, "continuity", "state.md");
  if (!fs.existsSync(statePath)) {
    return;
  }
  const text = plan?.get(statePath) ?? readTextFile(statePath);
  const data = parseFrontmatter(text, statePath).data;
  if (data["current-chapter"] !== from) {
    return;
  }
  const next = replaceFrontmatter(text, { ...data, "current-chapter": to });
  if (plan) {
    if (!plan.has(statePath)) {
      plan.originals.set(statePath, text);
    }
    plan.set(statePath, next);
  } else {
    writeFile(statePath, next, { root, unchangedFrom: text });
  }
}

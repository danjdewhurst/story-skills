// story merge: two adjacent chapters made one, with their notes, fields, and
// progressions combined.
import fs from "node:fs";
import path from "node:path";
import { idText } from "./continuity.js";
import { chapterChronology } from "./chronology.js";
import { PROGRESSION_KINDS } from "./progressions.js";
import { parseFrontmatter, replaceFrontmatter } from "./frontmatter.js";
import { projectPath, removeFile } from "./files.js";
import { maskMarkup, proseStart } from "./markdown.js";
import { warn } from "./findings.js";
import { refusedError, usageError } from "./exit-codes.js";
import {
  CHAPTER_STATUSES,
  scanProject,
  assertProjectParses,
  canonicalChapterId,
  entityConfig,
  nextSceneNumber,
  readMarkdown,
  relative
} from "./scan.js";
import {
  withUndo,
  writeReferencePlan,
  undoReferencePlan,
  assertWritable
} from "./mutate-writes.js";
import {
  followExemptionPatterns,
  followQueryFilters,
  idRenamer,
  renameIdTokens,
  entityReferenceContext,
  renameLinkTargets,
  planReferenceRewrites
} from "./mutate-references.js";
import { reindexProject } from "./mutate-maintenance.js";
import {
  CHAPTER_NUMBER_HEADING,
  levelOneHeadings,
  reorderProgressions,
  moveScene
} from "./mutate-move.js";
import {
  restructureWrites,
  existingChapter,
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

export function mergeChapters(root, options) {
  return withUndo(root, ["merge", options.id, options.next], () => mergeNow(root, options));
}

function mergeNow(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "merge");
  const missing = "merge requires two chapter ids: the chapter to keep, then the one after it";
  const first = existingChapter(project, options.id, missing);
  const second = existingChapter(project, options.next, missing);
  if (first === second) {
    throw usageError(`merge needs two different chapters, got ${first.id} twice`);
  }
  const position = project.chapters.indexOf(first);
  if (project.chapters[position + 1] !== second) {
    const secondPosition = project.chapters.indexOf(second);
    if (secondPosition < position) {
      throw usageError(`${second.id} comes before ${first.id}: name the earlier chapter first (story merge ${second.id} ${first.id})`);
    }
    const between = project.chapters.slice(position + 1, secondPosition).map((chapter) => chapter.id);
    throw usageError(`${second.id} does not follow ${first.id}: merge takes neighbouring chapters, and ${between.join(", ")} ${between.length === 1 ? "comes" : "come"} between them`);
  }
  const choices = refuseUnsafeBranching(project, "merge", [first, second], second);

  const scenes = project.scenes.filter((scene) => scene.chapter === second.id).sort((left, right) => left.scene - right.scene);
  const firstScene = nextSceneNumber(project, first.id);
  const sceneFiles = scenes.map((scene, index) => path.join(project.root, "scenes", `${first.id}-scene-${String(firstScene + index).padStart(2, "0")}.md`));
  const taken = sceneFiles.find((file) => fs.existsSync(file));
  if (taken) {
    throw refusedError(`${relative(project, taken)} already exists; nothing was changed`);
  }
  const run = followingRun(project, second.number + 1);
  const runIds = new Set(run.map((entry) => entry.id));
  assertRestructurable(project, {
    chapters: [first.id, second.id, ...runIds],
    scenes: [...scenes, ...project.scenes.filter((scene) => runIds.has(scene.chapter))].map((scene) => scene.id),
    changed: [first.file, second.file, ...scenes.map((scene) => scene.file), ...chapterRunFiles(project, run)],
    created: sceneFiles,
    chapterTargets: run.map((entry) => path.join(project.root, "chapters", `${canonicalChapterId(entry.number - 1)}.md`))
  });

  const warnings = [];
  restructureWrites(project.root, () => {
    // The scenes go first, so the chapter they leave is the only file that
    // still names it by id.
    for (const [index, scene] of scenes.entries()) {
      warnings.push(...moveScene(scanProject(project.root), scene.id, { chapter: first.id, scene: String(firstScene + index) }, "merge").warnings);
    }
    const current = scanProject(project.root);
    const kept = readMarkdown(first.file, project.root);
    const gone = readMarkdown(second.file, project.root);
    const merged = mergedChapter(kept, gone, current.unit, first.id, second.id);
    warnings.push(...merged.warnings);
    const context = entityReferenceContext(project.root, "chapter", second.id);
    const plan = planReferenceRewrites(project.root, context, new Map([[first.file, merged.text], [second.file, null]]),
      idRenamer(second.id, first.id),
      (body, file) => renameIdTokens(project.root, file, renameLinkTargets(project.root, file, body, context, first.id), second.id, first.id));
    plan.originals.set(first.file, kept.rawMarkdown);
    setCurrentChapter(project.root, second.number, first.number, plan);
    followExemptionPatterns(project.root, plan, "chapter", second.id, first.id);
    followQueryFilters(project.root, plan, "chapter", second.id, first.id);
    reorderProgressions(current, plan, chapterChronology(current));
    warnings.push(...mergeProgressions(project.root, plan, first.id));
    assertWritable(project.root, [...plan.keys(), second.file]);
    writeReferencePlan(project.root, plan);
    try {
      removeFile(second.file, { root: project.root, unchangedFrom: gone.rawMarkdown });
    } catch (error) {
      // Saved since it was read: the merged text lacks the save, so this
      // step is put back. The scenes already moved stay with the first
      // chapter, and a rerun merges the rest.
      if (error.changedOnDisk) {
        undoReferencePlan(project.root, plan);
        Object.assign(error, {
          message: `${relative(project, second.file)} changed on disk while story was merging it into ${first.id}, so it was left as it is and ${relative(project, first.file)} was put back`,
          hint: "Run the same command again to merge it with the change",
          resumable: true
        });
      }
      throw error;
    }
    shiftChapters(project.root, run, -1, warnings, "merge");
  });
  const reindexed = reindexProject(project.root);
  return {
    kind: "chapter",
    id: first.id,
    mergedId: second.id,
    file: first.file,
    scenesMoved: scenes.length,
    renumbered: run.length,
    choicesRetargeted: retargetedChoices(project, choices, run, -1),
    changed: [first.file].concat(reindexed.changed),
    warnings
  };
}

// After a merge, two progressions of one field can start in the kept
// chapter: one from each half. The later one is the value the chapter ends
// with, so it is kept and the earlier dropped, which validate would
// otherwise reject as a repeat.
function mergeProgressions(root, plan, chapterId) {
  const dirs = PROGRESSION_KINDS.map((kind) => entityConfig(kind).dir);
  const warnings = [];
  for (const [file, text] of plan) {
    if (text === null || !dirs.includes(projectPath(root, path.dirname(file)))) {
      continue;
    }
    const data = parseFrontmatter(text, file).data;
    if (!Array.isArray(data.progressions)) {
      continue;
    }
    const last = new Map();
    data.progressions.forEach((item, index) => {
      if (item && typeof item === "object" && !Array.isArray(item) && idText(item.from) === chapterId && typeof item.field === "string") {
        last.set(item.field, index);
      }
    });
    const dropped = [];
    const progressions = data.progressions.filter((item, index) => {
      const repeated = item && typeof item === "object" && !Array.isArray(item) && idText(item.from) === chapterId
        && typeof item.field === "string" && last.get(item.field) !== index;
      if (repeated) {
        dropped.push(`${item.field} ${JSON.stringify(item.value)}`);
      }
      return !repeated;
    });
    if (dropped.length > 0) {
      plan.set(file, replaceFrontmatter(text, { ...data, progressions }));
      const label = projectPath(root, file);
      warnings.push(warn("merge-conflicts", `${label} changed the same ${dropped.length === 1 ? "field" : "fields"} in both merged chapters; the earlier ${dropped.length === 1 ? "progression" : "progressions"} (${dropped.join(", ")}) ${dropped.length === 1 ? "was" : "were"} dropped and the later value kept from ${chapterId}`, label));
    }
  }
  return warnings;
}

const BLANK_VALUES = [undefined, null, ""];

function isBlankValue(value) {
  return BLANK_VALUES.includes(value) || (Array.isArray(value) && value.length === 0);
}

// Chapter fields a merge never takes from the second chapter: it works them
// out, or keeps the first chapter's `numbered`, since a missing one means
// true (mergedChapter warns when the two differ).
const MERGE_DERIVED_FIELDS = new Set(["title", "number", "word-count", "character-count", "hook", "numbered"]);

const MERGE_SUMMED_FIELDS = new Set(["target-words", "target-characters"]);

// The frontmatter of two merged chapters: the first chapter's, with lists
// joined (each item once), a field only the second sets added, targets
// summed, the earlier status of the two, and the second chapter's hook, since
// the merged chapter ends where the second did. Any other field the two set
// differently keeps the first chapter's value and is listed in `conflicts`.
function mergedChapterData(firstData, secondData) {
  const data = { ...firstData };
  const conflicts = [];
  const statuses = [...CHAPTER_STATUSES];
  for (const [key, value] of Object.entries(secondData)) {
    if (MERGE_DERIVED_FIELDS.has(key) || isBlankValue(value)) {
      continue;
    }
    const current = firstData[key];
    if (!Object.hasOwn(firstData, key) || isBlankValue(current)) {
      data[key] = value;
    } else if (Array.isArray(current) && Array.isArray(value)) {
      const seen = new Set(current.map((item) => JSON.stringify(item)));
      data[key] = current.concat(value.filter((item) => !seen.has(JSON.stringify(item)) && seen.add(JSON.stringify(item))));
    } else if (MERGE_SUMMED_FIELDS.has(key) && Number.isInteger(current) && Number.isInteger(value)) {
      data[key] = current + value;
    } else if (key === "status" && statuses.includes(current) && statuses.includes(value)) {
      data[key] = statuses[Math.min(statuses.indexOf(current), statuses.indexOf(value))];
    } else if (JSON.stringify(current) !== JSON.stringify(value)) {
      conflicts.push(`${key} ${JSON.stringify(value)}`);
    }
  }
  if (!isBlankValue(secondData.hook)) {
    data.hook = secondData.hook;
  } else if (Object.hasOwn(data, "hook")) {
    delete data.hook;
  }
  const droppedHook = isBlankValue(secondData.hook) && !isBlankValue(firstData.hook) ? firstData.hook : null;
  return { data, conflicts, droppedHook };
}

const CHAPTER_TEXT_HEADING = /^ {0,3}##[ \t]+Chapter Text(?:[ \t]+#+)?[ \t]*\r?$/i;

const NOTE_SECTION_HEADING = /^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*\r?$/gm;

// The lines that close a chapter's notes: the outline divider and the
// `## Chapter Text` heading, as masked text.
function closesNotes(line) {
  const text = line.trim();
  return text === "---" || CHAPTER_TEXT_HEADING.test(text);
}

// The chapter's own `# heading` before `limit`: its first level-1 heading
// when no `##` section comes before it, else its first `# Chapter N`. So a
// level-1 heading among the notes (`# Ideas` under `## Outline`) is not
// taken for it.
function ownHeading(body, masked, limit) {
  const headings = levelOneHeadings(body, masked, limit);
  const section = /^ {0,3}#{2,6}(?:[ \t]|\r?$)/m.exec(masked.slice(0, limit));
  if (headings.length > 0 && (section === null || headings[0].index < section.index)) {
    return headings[0];
  }
  return headings.find((entry) => CHAPTER_NUMBER_HEADING.test(entry.line)) ?? null;
}

// The planning notes of a chapter body: what lies between its `# heading`
// and its prose (the outline and any other `##` sections), as offsets in the
// body, without the blank lines, comments, outline divider, and `## Chapter
// Text` heading that close them. `lead` is where the heading starts.
function chapterNotesRange(body, masked, proseOffset) {
  const heading = ownHeading(body, masked, proseOffset);
  const lead = heading ? heading.index : 0;
  const start = heading ? heading.end : 0;
  const lines = masked.slice(start, proseOffset).split("\n");
  let offset = start;
  const starts = lines.map((line) => {
    const lineStart = offset;
    offset += line.length + 1;
    return lineStart;
  });
  let end = proseOffset;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() !== "" && !closesNotes(lines[index])) {
      break;
    }
    end = starts[index];
  }
  // The notes end after the last text masked text shows, and after any
  // comment that opens on that line, so the comment stays on its line and
  // the notes never end inside it.
  let cut = start + masked.slice(start, end).trimEnd().length;
  for (let open = cut > start ? commentOnLine(body, cut) : -1; open !== -1; open = commentOnLine(body, cut)) {
    cut = body.indexOf("-->", open + 4) + 3;
  }
  return { lead, start, end: cut };
}

// Where a comment opens on the rest of the line at `offset`, if only blanks
// come before it, or -1.
function commentOnLine(body, offset) {
  const lineEnd = body.indexOf("\n", offset);
  const rest = body.slice(offset, lineEnd === -1 ? body.length : lineEnd);
  const open = offset + rest.search(/\S|$/);
  return body.startsWith("<!--", open) ? open : -1;
}

// The notes of the chapter a merge folds in, as its text and masked text:
// everything before its prose but its `# heading`, the outline divider, and
// the `## Chapter Text` heading. So text above the heading and a comment
// after the notes, which masked text shows as blank, are kept.
function foldedNotes(body, masked, proseOffset) {
  const range = chapterNotesRange(body, masked, proseOffset);
  const lines = body.slice(range.end, proseOffset).split("\n");
  const closing = masked.slice(range.end, proseOffset).split("\n").map(closesNotes);
  // A closing line goes with the blank line after it.
  const dropped = lines.map((line, index) => closing[index] || (index > 0 && closing[index - 1] && line.trim() === ""));
  const after = (text) => text.slice(range.end, proseOffset).split("\n").filter((line, index) => !dropped[index]).join("\n");
  const tail = after(body);
  const from = tail.length - tail.trimStart().length;
  const to = tail.trimEnd().length;
  const notes = (text) => `${text.slice(0, range.lead)}${text.slice(range.start, range.end)}${to > from ? `\n\n${after(text).slice(from, to)}` : ""}`;
  return { text: notes(body), masked: notes(masked) };
}

// Notes as a preamble and `##` sections, each { key, heading, body }.
function noteSections(text, masked) {
  const headings = [...masked.matchAll(NOTE_SECTION_HEADING)];
  const sections = headings.map((match, index) => {
    const lineEnd = match.index + match[0].length;
    return {
      key: match[1].trim().toLowerCase(),
      heading: text.slice(match.index, lineEnd).replace(/\r$/, ""),
      body: text.slice(lineEnd, index + 1 < headings.length ? headings[index + 1].index : text.length)
    };
  });
  return { preamble: text.slice(0, headings[0]?.index ?? text.length), sections };
}

// Joins two blocks of notes: a list continues on the next line, anything
// else after a blank line.
function joinNotes(first, second) {
  const left = first.trimEnd();
  const right = second.trim();
  if (left.trim() === "" || right === "") {
    return left.trim() === "" ? right : left;
  }
  const listItem = /^\s*(?:[-*+]|\d+[.)])[ \t]/;
  return `${left}${listItem.test(left.split("\n").at(-1)) && listItem.test(right.split("\n")[0]) ? "\n" : "\n\n"}${right}`;
}

// The body of two merged chapters: the first chapter's heading and notes,
// with the second chapter's notes added section by section (its outline
// beats after the first one's, a section only it has at the end), then the
// first chapter's prose, a scene break, and the second chapter's prose. The
// scene break is the first one either chapter already uses, else `* * *`.
// Of the second chapter's text, only its heading, outline divider, and
// `## Chapter Text` heading are dropped.
function mergedChapterBody(firstBody, secondBody, firstNumber, secondNumber) {
  const firstMasked = maskMarkup(firstBody);
  const secondMasked = maskMarkup(secondBody);
  const firstStart = mergedProseStart(firstBody, firstMasked, firstNumber);
  const secondStart = mergedProseStart(secondBody, secondMasked, secondNumber);
  let head = firstBody.slice(0, firstStart);
  let firstProse = firstBody.slice(firstStart);
  const secondNotes = foldedNotes(secondBody, secondMasked, secondStart);
  if (secondNotes.text.trim() !== "") {
    const firstRange = chapterNotesRange(firstBody, firstMasked, firstStart);
    const notes = noteSections(firstBody.slice(firstRange.start, firstRange.end), firstMasked.slice(firstRange.start, firstRange.end));
    const added = noteSections(secondNotes.text, secondNotes.masked);
    notes.preamble = joinNotes(notes.preamble, added.preamble);
    for (const section of added.sections) {
      const match = notes.sections.find((entry) => entry.key === section.key);
      if (match) {
        match.body = joinNotes(match.body, section.body);
      } else {
        notes.sections.push(section);
      }
    }
    const text = [notes.preamble.trim(), ...notes.sections.map((section) => joinNotes(section.heading, section.body))].filter((part) => part !== "").join("\n\n");
    const tail = head.slice(firstRange.end);
    head = `${head.slice(0, firstRange.start)}\n${text}${firstRange.end === firstRange.start ? "\n" : ""}${tail}`;
    // The notes need a `## Chapter Text` heading after them to stay out of
    // the prose.
    if (!firstMasked.slice(0, firstStart).split("\n").some((line) => CHAPTER_TEXT_HEADING.test(line))) {
      head = `${head.trimEnd()}\n\n## Chapter Text\n\n`;
      firstProse = firstProse.replace(/^(?:[ \t]*\r?\n)+/, "");
    }
  }
  const blankLines = /^(?:[ \t]*\r?\n)*/;
  const lead = firstProse.match(blankLines)[0] || (head === "" || head.endsWith("\n") ? "" : "\n\n");
  const firstText = firstProse.replace(blankLines, "").trimEnd();
  const secondProse = secondBody.slice(secondStart).replace(blankLines, "").trimEnd();
  const parts = [firstText];
  if (firstText !== "" && secondProse !== "") {
    parts.push(sceneBreakLine(firstBody) ?? sceneBreakLine(secondBody) ?? "* * *");
  }
  parts.push(secondProse);
  return `${head}${lead}${parts.filter((part) => part !== "").join("\n\n")}\n`;
}

// Where a merge takes a chapter's prose to start. A chapter with no
// `## Chapter Text` or outline and text above its heading reads as prose
// from the top, heading and all; a merge still ends the part above the
// prose at its heading, when that is its first level-1 heading and reads
// `# Chapter N` with its own number.
function mergedProseStart(body, masked, number) {
  const start = proseStart(body, masked);
  const heading = start === 0 ? levelOneHeadings(body, masked)[0] : undefined;
  const match = heading === undefined ? null : CHAPTER_NUMBER_HEADING.exec(heading.line);
  return match !== null && Number(match[2]) === number ? heading.end : start;
}

// The first scene break line a chapter body's prose uses, or null.
function sceneBreakLine(body) {
  const paragraph = proseParagraphs(body).find((entry) => entry.sceneBreak);
  return paragraph ? body.slice(paragraph.start, paragraph.end).trim() : null;
}

// The merged chapter file, from the first chapter's markdown, with the
// warnings for fields the second set differently.
function mergedChapter(first, second, unit, firstId, secondId) {
  const body = withLineEndings(mergedChapterBody(first.body, second.body, first.data.number, second.data.number), first.rawMarkdown);
  const { data, conflicts, droppedHook } = mergedChapterData(first.data, second.data);
  const label = `chapters/${firstId}.md`;
  const warnings = [];
  if (conflicts.length > 0) {
    warnings.push(warn("merge-conflicts", `${secondId} set ${conflicts.join(", ")}, which the merged ${firstId} does not take: it keeps ${firstId}'s values. Check them`, label));
  }
  if (droppedHook !== null) {
    warnings.push(warn("merge-conflicts", `${firstId}'s hook ${JSON.stringify(droppedHook)} was dropped: the merged chapter ends where ${secondId} did, and ${secondId} had no hook. Set one if it needs it`, label));
  }
  // The merged chapter keeps the first chapter's numbering, so a merge with
  // an unnumbered chapter (a prologue, an interlude) never changes which
  // chapters the builds number without saying so.
  const numbered = (data) => data.numbered !== false;
  if (numbered(first.data) !== numbered(second.data)) {
    warnings.push(warn("merge-conflicts", numbered(first.data)
      ? `${secondId} is unnumbered (numbered: false) but ${firstId} is not: the merged ${firstId} stays numbered. Set numbered: false on it if it should not be`
      : `${firstId} is unnumbered (numbered: false) but ${secondId} is not: the merged ${firstId} stays unnumbered. Remove numbered: false from it if it should be numbered`, label));
  }
  return { text: replaceFrontmatter(first.rawMarkdown, { ...data, ...chapterLengthFields(body, unit) }, body), warnings };
}

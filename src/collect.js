// `story collect`: rewrites a collection's chapters from the story projects
// its story.md `stories` list names, so each story is edited only in its own
// project. Each story becomes one chapter, as `story import` makes one from
// the story's chapter file (see docs/series.md, Short-story collections and
// anthologies). A chapter collect wrote records the story it came from in
// `collected-from` and a hash of what it wrote in `collected-hash`: the hash
// tells which stories changed since the last run, and whether the chapter
// was edited in the collection since. Only those chapters are rewritten or
// removed; a chapter written by hand keeps its file and its number.
import fs from "node:fs";
import path from "node:path";
import { err, outputText, warn } from "./findings.js";
import { contentHash, currentText, isPathInside, lstatIfExists, projectPath, readTextFile, removeFile, writeFile } from "./files.js";
import { parseFrontmatter, replaceFrontmatter } from "./frontmatter.js";
import { importedChapterBody, importedChapterData, importedChapterText } from "./import.js";
import { languagePack, projectLanguage } from "./languages/index.js";
import { characterCount, proseStart, scanComments, wordCount } from "./markdown.js";
import { countUnit } from "./forms.js";
import { plural } from "./plural.js";
import { nameList, publishingMeta } from "./publishing.js";
import { assertProjectParses, relative, scanProject } from "./scan.js";
import { readMarkdown } from "./scan-files.js";
import { canonicalPath } from "./series.js";
import { reindexProject } from "./mutate-maintenance.js";
import { assertWritable, withUndo } from "./mutate-writes.js";
import { interruptedChange } from "./undo.js";
import { removeEntityReferences } from "./mutate-references.js";
import { mirrorFolderNames } from "./preview.js";
import { SNAPSHOTS_DIR, nextSnapshotId, snapshotProject } from "./snapshots.js";
import { PATH_CONTROL_CHARACTERS } from "./scan-ids.js";
import { shellWord } from "./report.js";
import { projectError, refusedError } from "./exit-codes.js";

// As many stories as import reads files from a folder.
export const MAX_COLLECTION_STORIES = 500;

// What joins the chapters of a story told in several: a scene break, as the
// collections guide says to join them before an import.
const CHAPTER_JOIN = "\n\n* * *\n\n";

// The story projects a collection's `stories` names, in order, and the
// problems with the list, for story validate and story collect alike. Each
// entry is a path relative to the collection, with / separators, to a
// story project in the folder that holds the collection (or below it), but
// not the collection itself or a folder inside it. `root` is the
// collection's folder; `data` its story.md frontmatter. Returns { stories:
// [{ path, root, data }], errors }, where `path` is the entry as written.
// Entries that are not text are left to the field checks.
export function collectionStories(root, data) {
  const errors = [];
  const stories = [];
  const raw = data?.stories;
  if (!Array.isArray(raw)) {
    return { stories, errors };
  }
  const entries = raw.filter((value) => typeof value === "string" && value.trim() !== "");
  if (entries.length > MAX_COLLECTION_STORIES) {
    errors.push(err("collection-too-many-stories", `story.md stories names ${entries.length} stories, over the ${MAX_COLLECTION_STORIES} story limit`, "story.md"));
    return { stories, errors };
  }
  const collection = canonicalPath(root);
  const parent = path.dirname(collection);
  const seen = new Map();
  for (const value of entries) {
    const entry = value.trim();
    const label = `story.md stories ${outputText(entry)}`;
    // A control character cannot be part of a folder name a file system
    // looks up, and a NUL stops every file call.
    if (PATH_CONTROL_CHARACTERS.test(entry)) {
      errors.push(err("collection-story-not-project", `${label} holds a control character, so it names no story project folder`, "story.md"));
      continue;
    }
    if (entry.includes("\\")) {
      errors.push(err("collection-story-backslash", `${label} uses a backslash; write ${entry.replace(/\\/g, "/")} so the path works on every system`, "story.md"));
      continue;
    }
    if (path.isAbsolute(entry) || path.win32.isAbsolute(entry)) {
      errors.push(err("collection-story-outside", `${label} is an absolute path; name the story project relative to this collection, such as ../${path.basename(entry)}`, "story.md"));
      continue;
    }
    const target = path.resolve(root, entry);
    // Compared by real path, so a link cannot lead out of the folder.
    const real = canonicalPath(target);
    if (real === collection || isPathInside(collection, real)) {
      errors.push(err("collection-story-self", `${label} is this collection or a folder inside it; a story is its own project beside the collection`, "story.md"));
      continue;
    }
    // As with series links, a story is a sibling folder, so collect reads
    // nothing further from the collection than the folder beside it.
    if (path.dirname(real) !== parent) {
      errors.push(err("collection-story-outside", `${label} is not a sibling folder of this collection; keep each story project in the folder that holds the collection, such as ../low-tide`, "story.md"));
      continue;
    }
    if (seen.has(real)) {
      errors.push(err("collection-story-duplicate", `${label} names the same story project as ${outputText(seen.get(real))}; list each story once`, "story.md"));
      continue;
    }
    seen.set(real, entry);
    const storyFile = path.join(target, "story.md");
    let isProject;
    try {
      isProject = fs.statSync(target, { throwIfNoEntry: false })?.isDirectory() === true && fs.lstatSync(storyFile, { throwIfNoEntry: false })?.isFile() === true;
    } catch (error) {
      // A path through a file (ENOTDIR) names no folder; a folder that
      // cannot be read (EACCES) is unreadable.
      if (error.code !== "ENOTDIR") {
        errors.push(err("collection-story-unreadable", `${label}: ${error.code ?? error.message}`, "story.md"));
        continue;
      }
      isProject = false;
    }
    if (!isProject) {
      errors.push(err("collection-story-not-project", `${label} is not a story project: missing story.md`, "story.md"));
      continue;
    }
    let story;
    try {
      story = parseFrontmatter(readTextFile(storyFile), storyFile).data;
    } catch (error) {
      errors.push(err("collection-story-unreadable", `${label}: ${outputText(error.message.replace(storyFile, "story.md"))}`, "story.md"));
      continue;
    }
    stories.push({ path: entry, root: target, real, data: story });
  }
  return { stories, errors };
}

// Rewrites the chapters of the collection at `root` from its stories. With
// --dry-run `root` is a copy of the collection, so the stories are read
// from `sourceRoot`, the collection itself, and every path is worked out
// from there. `force` rewrites or removes a collected chapter edited in the
// collection since collect wrote it, after saving the collection as
// snapshot before-collect-<n>. Everything is read and checked before the
// first write.
export function collectStories(root, { sourceRoot = root, force = false } = {}) {
  return withUndo(root, ["collect", ...(force ? ["--force"] : [])], (plan) => writeCollection(plan), {
    beforeLog() {
      const plan = planCollection(root, sourceRoot, force);
      if (plan.edited.length > 0) {
        plan.snapshot = snapshotBeforeCollect(plan.project.root, sourceRoot);
      }
      return plan;
    }
  });
}

function planCollection(root, sourceRoot, force) {
  const project = scanProject(root);
  assertProjectParses(project, "collect");
  const data = project.story.data;
  if (data.stories === undefined) {
    throw projectError("story.md has no stories list: add stories, the story project folders in reading order, such as stories: [../low-tide, ../salt]");
  }
  if (!Array.isArray(data.stories) || data.stories.some((value) => typeof value !== "string" || value.trim() === "")) {
    throw projectError("story.md stories must be a list of story project folders, such as stories: [../low-tide, ../salt]");
  }
  const { stories, errors } = collectionStories(sourceRoot, data);
  if (errors.length > 0) {
    throw projectError(`Cannot collect: fix story.md stories first; nothing was changed:\n${errors.map((error) => `- ${error.message}`).join("\n")}`);
  }

  const unit = countUnit(data, languagePack(projectLanguage(data)));
  const ownAuthors = publishingMeta(data).authors;
  const chapters = [...project.chapters].sort(byNumber);
  const collected = [];
  const handWritten = [];
  for (const chapter of chapters) {
    const markdown = readMarkdown(chapter.file, project.root);
    const from = markdown.data["collected-from"];
    if (typeof from === "string" && from.trim() !== "") {
      const real = PATH_CONTROL_CHARACTERS.test(from) ? null : canonicalPath(path.resolve(sourceRoot, from.trim()));
      collected.push({ chapter, markdown, real, from: from.trim(), intact: isIntact(markdown) });
    } else {
      handWritten.push({ chapter, markdown });
    }
  }

  // Each story takes, in list order, the lowest number no hand-written
  // chapter holds.
  const taken = new Set(handWritten.map((entry) => entry.chapter.number));
  let next = 1;
  const claimed = new Set();
  const planned = stories.map((story) => {
    while (taken.has(next)) {
      next += 1;
    }
    const number = next;
    next += 1;
    const content = storyContent(story, ownAuthors);
    // The first chapter collected from the story is its chapter; a second
    // copy is replaced like any chapter of a story gone.
    const previous = collected.find((entry) => entry.real === story.real && !claimed.has(entry));
    if (previous) {
      claimed.add(previous);
    }
    return { story, number, content, previous };
  });
  // A story whose folder was renamed or moved keeps its chapter, and the
  // fields set on it, when that chapter still holds what collect wrote.
  for (const entry of planned.filter((candidate) => candidate.previous === undefined)) {
    const renamed = collected.find((candidate) => !claimed.has(candidate) && candidate.intact && candidate.markdown.data["collected-hash"] === entry.content.hash);
    if (renamed) {
      claimed.add(renamed);
      entry.previous = renamed;
    }
  }
  const leaving = collected.filter((entry) => !claimed.has(entry));

  const edited = [...planned.map((entry) => entry.previous).filter(Boolean), ...leaving].filter((entry) => !entry.intact);
  if (edited.length > 0 && !force) {
    const files = edited.map((entry) => relative(project, entry.chapter.file));
    throw refusedError(`Cannot collect: ${files.join(", ")} ${files.length === 1 ? "was" : "were"} changed in the collection since story collect wrote ${files.length === 1 ? "it" : "them"}, and collect would replace ${files.length === 1 ? "that edit" : "those edits"}; nothing was changed. Make the edit in the story project instead. story collect --force discards it, after saving the collection as snapshot before-collect-<n>`);
  }

  const chaptersDir = path.join(project.root, "chapters");
  const ownFiles = new Set(collected.map((entry) => entry.chapter.file));
  const writes = planned.map((entry) => {
    const file = path.join(chaptersDir, `chapter-${String(entry.number).padStart(2, "0")}.md`);
    if (!ownFiles.has(file) && lstatIfExists(file) !== null) {
      throw refusedError(`Cannot collect: ${projectPath(project.root, file)} is in the way of story ${outputText(entry.story.path)}, and story collect did not write it; nothing was changed. Rename it, or give its chapter the number in its file name`);
    }
    return { ...entry, file, text: chapterText(entry, unit), original: currentText(file) };
  });
  const written = new Set(writes.map((entry) => entry.file));
  const removals = collected.filter((entry) => !written.has(entry.chapter.file));
  assertNoChapterReferences(project, writes, leaving, ownFiles);
  assertWritable(project.root, [...writes.map((entry) => entry.file), ...removals.map((entry) => entry.chapter.file)]);
  return { project, writes, removals, leaving, handWritten, edited, snapshot: null };
}

function writeCollection({ project, writes, removals, leaving, handWritten, snapshot }) {
  const changed = [];
  for (const entry of writes) {
    if (entry.original !== entry.text) {
      writeFile(entry.file, entry.text, { root: project.root, unchangedFrom: entry.original });
      changed.push(entry.file);
    }
  }
  for (const entry of removals) {
    removeFile(entry.chapter.file, { root: project.root, unchangedFrom: entry.markdown.rawMarkdown });
    changed.push(entry.chapter.file);
  }
  const reindexed = changed.length === 0 ? { changed: [] } : reindexProject(project.root);

  const chapterId = (file) => path.basename(file, ".md");
  return {
    stories: writes.map((entry) => ({
      path: entry.story.path,
      title: entry.content.title,
      chapter: chapterId(entry.file),
      file: projectPath(project.root, entry.file),
      status: entry.previous === undefined ? "added" : entry.previous.markdown.data["collected-hash"] === entry.content.hash ? "unchanged" : "changed",
      from: entry.previous === undefined || entry.previous.chapter.file === entry.file ? null : entry.previous.chapter.id,
      replacedEdit: entry.previous !== undefined && !entry.previous.intact
    })),
    removed: leaving.map((entry) => ({
      path: entry.from,
      chapter: entry.chapter.id,
      file: relative(project, entry.chapter.file),
      replacedEdit: !entry.intact
    })),
    snapshot,
    changed: changed.concat(reindexed.changed),
    warnings: handWrittenCopies(project, handWritten, writes)
  };
}

// collect moves a story's chapter to another number when the list changes,
// and removes it when the story leaves, without rewriting what names the
// chapter: a scene, a death, a clue's plant, a timeline row. Those would
// then name another story, or none, so collect refuses while a moving or
// leaving chapter is named anywhere but in the chapters it writes. The
// guide keeps such records in each story's own project.
function assertNoChapterReferences(project, writes, leaving, ownFiles) {
  const moving = [
    ...writes.filter((entry) => entry.previous !== undefined && entry.previous.chapter.file !== entry.file).map((entry) => ({ id: entry.previous.chapter.id, story: entry.story.path, to: path.basename(entry.file, ".md") })),
    ...leaving.map((entry) => ({ id: entry.chapter.id, story: entry.from, to: null }))
  ];
  if (moving.length === 0) {
    return;
  }
  const regenerated = new Map([...ownFiles].map((file) => [file, null]));
  const problems = [];
  for (const { id, story, to } of moving) {
    const files = [
      ...project.scenes.filter((scene) => scene.chapter === id).map((scene) => scene.file),
      ...removeEntityReferences(project.root, "chapter", id, regenerated).keys()
    ];
    const named = [...new Set(files.map((file) => relative(project, file)))].sort();
    if (named.length > 0) {
      problems.push(`${id} (story ${outputText(story)}) would ${to === null ? "be removed" : `move to ${to}`}, but ${named.join(", ")} ${named.length === 1 ? "names" : "name"} it`);
    }
  }
  if (problems.length > 0) {
    throw refusedError(`Cannot collect: story collect does not rewrite what names a collected chapter, so these would name the wrong story; nothing was changed:\n${problems.map((problem) => `- ${problem}`).join("\n")}\nKeep scenes, characters, and other records that name chapters in each story's own project, or point them at another chapter first`);
  }
}

// --force saves the collection first, as import --force does, since the
// edits it replaces exist nowhere else. A --dry-run runs on a copy without
// .snapshots/, so the copy is given the collection's snapshot folder names
// first and numbers the snapshot as the real run would.
function snapshotBeforeCollect(root, sourceRoot) {
  if (path.resolve(root) !== path.resolve(sourceRoot)) {
    mirrorFolderNames(path.join(sourceRoot, SNAPSHOTS_DIR), path.join(root, SNAPSHOTS_DIR));
  }
  const id = nextSnapshotId(root, "before-collect-");
  const snapshot = snapshotProject(root, { name: id, id, unparsed: true });
  return { id: snapshot.id, dir: snapshot.dir, restore: `story snapshot --restore ${snapshot.id}` };
}

// The chapter a story becomes: its story.md title, its writer when that is
// not the collection's own author, and the prose of its chapters in order,
// each the text under ## Chapter Text as import reads it, joined by a scene
// break. `hash` covers all three, so a change to any shows.
function storyContent(story, ownAuthors) {
  const project = scanProject(story.root);
  const label = `story ${outputText(story.path)}`;
  // A story another command stopped part way in would be read half made,
  // whatever the command, collect included (a story can be a collection).
  const interrupted = interruptedChange(story.root);
  if (interrupted !== null) {
    throw refusedError(`Cannot collect: ${outputText(interrupted.command)} stopped part way in ${label}, so collect would read a change made only in part; nothing was changed. Run story doctor --fix --path ${shellWord(story.path)} to put it back, or run that command again there to finish it`);
  }
  try {
    assertProjectParses(project, `collect ${label}`);
  } catch (error) {
    error.message = error.message.startsWith("Cannot collect") ? error.message : `${label}: ${error.message}`;
    throw error;
  }
  const chapters = [...project.chapters].sort(byNumber);
  if (chapters.length === 0) {
    throw projectError(`Cannot collect: ${label} has no chapters yet; write the story, or take it out of story.md stories`);
  }
  const prose = chapters
    .map((chapter) => chapterProseText(readMarkdown(chapter.file, project.root).body))
    .filter((text) => text !== "")
    .join(CHAPTER_JOIN);
  const title = String(story.data.title ?? "").replace(/\s+/g, " ").trim() || path.basename(story.root);
  const storyAuthors = publishingMeta(story.data).authors.map((name) => name.replace(/\s+/g, " "));
  // A collection by one writer credits them once, on its title page.
  const authors = sameNames(storyAuthors, ownAuthors) ? [] : storyAuthors;
  return { title, authors, prose, hash: contentHash(JSON.stringify([title, authors, prose])) };
}

// Chapters in number order, then by id, compared by code point so the order
// is the same in every locale.
function byNumber(left, right) {
  return left.number - right.number || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

// A chapter body's prose as import reads it from a chapter file: the text
// under ## Chapter Text (or after the outline or heading), trimmed, with LF
// line ends.
function chapterProseText(body) {
  const text = body.replace(/\r\n?/g, "\n");
  return text.slice(proseStart(text)).trim();
}

function sameNames(left, right) {
  return left.length === right.length && left.every((name) => right.includes(name));
}

// Whether a collected chapter still holds what collect wrote: its title,
// author, and prose hash to its `collected-hash`, and its body is the
// heading and ## Chapter Text that collect writes, so nothing added above
// the prose, such as an outline or a note, would be lost.
function isIntact(markdown) {
  const title = String(markdown.data.title ?? "").replace(/\s+/g, " ").trim();
  const authors = nameList(markdown.data.author).map((name) => name.replace(/\s+/g, " "));
  const prose = chapterProseText(markdown.body);
  const body = markdown.body.replace(/\r\n?/g, "\n").replace(/^\n+/, "");
  return markdown.data["collected-hash"] === contentHash(JSON.stringify([title, authors, prose]))
    && body === importedChapterBody(markdown.data, prose);
}

// The chapter file for a story at its number. A new chapter has the
// frontmatter import gives one; a chapter collected before keeps the
// fields collect does not own, such as its status and cast.
function chapterText({ story, number, content, previous }, unit) {
  const words = wordCount(scanComments(content.prose).text);
  const counts = unit.name === "characters"
    ? { "word-count": words, "character-count": characterCount(scanComments(content.prose).text) }
    : { "word-count": words };
  const collectedFields = { "collected-from": story.path, "collected-hash": content.hash };
  if (previous === undefined) {
    return importedChapterText({ ...importedChapterData(content.title, number, counts, false, content.authors), ...collectedFields }, content.prose);
  }
  // A chapter collected before keeps its own frontmatter text: each field
  // in its place, comments and formatting too, with only the fields collect
  // owns rewritten, and `author` set or taken out where it is.
  const data = { ...previous.markdown.data, title: content.title, number, ...counts, ...collectedFields };
  if (content.authors.length === 0) {
    delete data.author;
  } else {
    data.author = content.authors.length === 1 ? content.authors[0] : content.authors;
  }
  return replaceFrontmatter(previous.markdown.rawMarkdown, data, `\n${importedChapterBody(data, content.prose)}`);
}

// A chapter written by hand that has a collected story's title is most
// likely a copy from before the collection named its stories: collect
// leaves it, so the story would be in the book twice.
function handWrittenCopies(project, handWritten, writes) {
  const titles = new Map(writes.map((entry) => [entry.content.title.toLowerCase(), entry]));
  return handWritten.flatMap(({ chapter, markdown }) => {
    const title = String(markdown.data.title ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const match = titles.get(title);
    if (title === "" || match === undefined) {
      return [];
    }
    const file = relative(project, chapter.file);
    return [warn("collect-hand-written-copy", `${file} has the title of story ${match.story.path} but no collected-from, so story collect left it and wrote the story as ${path.basename(match.file, ".md")}; delete ${file} if it is an old copy`, file)];
  });
}

// The text story collect prints: a line for each story with its chapter and
// whether it changed since the last run, then each chapter it removed.
// `dryRun` words it as what would happen, before the preview's file list.
export function formatCollect(result, dryRun) {
  const lines = [];
  if (!dryRun) {
    lines.push(result.changed.length === 0
      ? `Collected ${plural(result.stories.length, "story", "stories")}: no story changed since the last run`
      : `Collected ${plural(result.stories.length, "story", "stories")}:`);
  }
  for (const story of result.stories) {
    const notes = [story.status];
    if (story.from !== null) {
      notes.push(`moved from ${story.from}`);
    }
    if (story.replacedEdit) {
      notes.push("replaced the edit made in the collection");
    }
    lines.push(`- ${outputText(story.path)}: ${story.chapter} "${outputText(story.title)}" (${notes.join("; ")})`);
  }
  for (const entry of result.removed) {
    const notes = [`was ${entry.chapter}`, ...(entry.replacedEdit ? ["replaced the edit made in the collection"] : [])];
    lines.push(`- ${outputText(entry.path)}: ${dryRun ? "would be removed" : "removed"}, as it is no longer in story.md stories (${notes.join("; ")})`);
  }
  if (result.snapshot) {
    lines.push(`${dryRun ? "Would save" : "Saved"} the collection as snapshot ${result.snapshot.id} before replacing the edits; ${result.snapshot.restore} puts it back`);
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

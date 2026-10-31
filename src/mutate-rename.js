// story rename and story remove, which rewrite or drop the references to an
// entity.
import fs from "node:fs";
import path from "node:path";
import { FRONTMATTER_PATTERN, replaceFrontmatter } from "./frontmatter.js";
import {
  assertSafeProjectPath,
  projectPath,
  RENAME_MARKER,
  readTextFile,
  removeFile,
  writeFile
} from "./files.js";
import { escapeRegExp, kebabCase } from "./markdown.js";
import { canonicalPath, discoverSeriesBooks, seriesLinkPath, seriesLinks } from "./series.js";
import { warn } from "./findings.js";
import { EXEMPTIONS_FILE } from "./exemptions.js";
import { queryFiltersNaming, shownFilter, shownQuery } from "./list.js";
import { refusedError, usageError } from "./exit-codes.js";
import { MENTION_KINDS, proseRenames } from "./mentions.js";
import {
  scanProject,
  assertProjectParses,
  requireSingleLineName,
  entityConfig,
  normalizeKind,
  assertPortableId,
  requireKebabId,
  requestedEntityId,
  undeducibleIdMessage,
  isKebabId,
  chapterChoices,
  branchGraph,
  readMarkdown,
  safeRead,
  relative
} from "./scan.js";
import {
  withUndo,
  flag,
  removeMovedFile,
  writeReferencePlan,
  assertWritable,
  commitWrites
} from "./mutate-writes.js";
import {
  assertUnambiguousId,
  ambiguousReferenceWarnings,
  EXEMPTION_TEXT_KEYS,
  exemptionEntries,
  followExemptionEntry,
  followExemptionPatterns,
  followQueryFilters,
  adoptedReferenceWarnings,
  idRenamer,
  renameIdTokens,
  entityReferenceContext,
  renameLinkTargets,
  replaceEntityReferences,
  removeEntityReferences,
  planReferenceRewrites
} from "./mutate-references.js";
import { reindexProject } from "./mutate-maintenance.js";

export function renameEntity(root, options) {
  return withUndo(root, ["rename", options.kind, options.id, options.name, ...flag("id", options.newId), ...(options.prose ? ["--prose"] : [])], () => renameNow(root, options));
}

function renameNow(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "rename");
  const kind = normalizeKind(options.kind);
  const oldId = String(options.id ?? "").trim();
  const name = String(options.name ?? "").trim();
  if (!oldId || !name) {
    throw usageError("rename requires an entity id and a new name");
  }
  requireSingleLineName(name, kind);
  const requestedId = requestedEntityId(kind, options.newId);

  const config = entityConfig(kind);
  const oldFile = path.join(project.root, config.dir, `${oldId}.md`);
  requireKebabId(oldId, `${kind} id`);
  assertSafeProjectPath(oldFile, project.root);
  // Chapter and scene ids derive from their numbers ({chapter}-scene-NN), so
  // renaming them changes only the title.
  const newId = kind === "chapter" || kind === "scene" ? oldId : (requestedId ?? kebabCase(name));
  if (!isKebabId(newId)) {
    throw usageError(undeducibleIdMessage(kind, name));
  }
  assertPortableId(newId, kind);
  const newFile = path.join(project.root, config.dir, `${newId}.md`);
  assertSafeProjectPath(newFile, project.root);
  if (!fs.existsSync(oldFile)) {
    // A rename killed after deleting the old file missed at most its
    // reindex: every reference was rewritten before the file moved. Its
    // marker says which rename it was, so resume only when the marker names
    // this one, the new file exists, and nothing still names the old id;
    // otherwise the old id is simply missing (a typo, or a rename that
    // already finished), and an unrelated entity that happens to have this
    // name must not absorb its references.
    const marker = renameMarker(project.root);
    if (marker?.kind === kind && marker.id === oldId && marker.newId === newId && marker.name === name && fs.existsSync(newFile)
      && replaceEntityReferences(project.root, kind, oldId, newId, new Map()).size === 0) {
      const reindexed = reindexProject(project.root);
      // The killed run never printed its warnings.
      const warnings = ambiguousReferenceWarnings(project.root, kind, oldId, newFile, newId);
      removeFile(path.join(project.root, RENAME_MARKER), { force: true });
      return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed), resumed: true, warnings };
    }
    throw usageError(`${kind} ${oldId} does not exist`);
  }
  let warnings = [];
  const prose = options.prose ? planProseRename(project, kind, oldId, name) : null;
  const proseFiles = prose?.files ?? new Map();

  const markdown = readMarkdown(oldFile, project.root);

  const data = { ...markdown.data, [config.titleField]: name };
  const retitled = retitleHeading(replaceFrontmatter(markdown.rawMarkdown, data), markdown.data[config.titleField], name);
  if (newFile === oldFile) {
    assertWritable(project.root, [oldFile, ...proseFiles.keys()]);
    // Only the files whose text changes are written: a rename to the name
    // the entity already has leaves its files as they are.
    commitWrites(() => {
      for (const [file, { original, next }] of proseFiles) {
        if (next !== original) {
          writeFile(file, next, { root: project.root, unchangedFrom: original });
        }
      }
      if (retitled !== markdown.rawMarkdown) {
        writeFile(oldFile, retitled, { root: project.root, unchangedFrom: markdown.rawMarkdown });
      }
    });
  } else {
    // Plan every rewrite before touching disk so a parse failure leaves the
    // project unchanged. Chapters renamed in prose are planned from their
    // new text, and written only if they still hold the text it came from.
    const overrides = new Map([[oldFile, retitled]]);
    for (const [file, { next }] of proseFiles) {
      overrides.set(file, next);
    }
    const plan = replaceEntityReferences(project.root, kind, oldId, newId, overrides);
    for (const [file, { original }] of proseFiles) {
      plan.originals.set(file, original);
    }
    followExemptionPatterns(project.root, plan, kind, oldId, newId);
    followQueryFilters(project.root, plan, kind, oldId, newId);
    const renamedContents = plan.get(oldFile);
    plan.delete(oldFile);
    // The new id is taken, unless an earlier run was killed after writing
    // the new file: then every reference already names the new id and the
    // file holds exactly what this rename writes, and only the old file is
    // left to delete.
    const interrupted = fs.existsSync(newFile) && plan.size === 0 && readTextFile(newFile) === renamedContents;
    if (fs.existsSync(newFile) && !interrupted) {
      throw refusedError(`${kind} ${newId} already exists`);
    }
    if (!interrupted) {
      assertUnambiguousId(project.root, kind, newId);
      warnings = adoptedReferenceWarnings(project.root, kind, newId, oldFile, "rename");
    }
    warnings = warnings.concat(ambiguousReferenceWarnings(project.root, kind, oldId, oldFile, newId));

    assertWritable(project.root, [...plan.keys(), oldFile], interrupted ? [] : [newFile]);
    // Before the first change, so a rerun can finish the rename even once
    // the old file is gone (see renameMarker). A marker an earlier rename
    // left is replaced, so it passes no unchangedFrom.
    writeFile(path.join(project.root, RENAME_MARKER), `${JSON.stringify({ kind, id: oldId, newId, name })}\n`, { root: project.root });
    // References first, the entity file last: if the command is killed
    // partway, the old file still exists and a rerun finishes the job.
    commitWrites(() => {
      writeReferencePlan(project.root, plan);
      if (!interrupted) {
        writeFile(newFile, renamedContents, { root: project.root, unchangedFrom: null });
      }
      removeMovedFile(project.root, { oldFile, original: markdown.rawMarkdown, newFile, written: renamedContents });
    });
  }

  if (newFile !== oldFile) {
    warnings = warnings.concat(linkedBookIdWarnings(project, kind, oldId, newId));
  }
  const reindexed = reindexProject(project.root);
  if (newFile !== oldFile) {
    // Finished, so a rerun reports the old id as missing.
    removeFile(path.join(project.root, RENAME_MARKER), { force: true });
  }
  const result = { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed), warnings };
  if (prose) {
    result.prose = { edits: prose.edits, aliases: prose.aliases, shared: prose.shared.length, review: prose.review };
    result.warnings = warnings.concat(prose.warnings);
  }
  return result;
}

// The rename the marker at the project root names, as { kind, id, newId,
// name }, or null when there is none or it cannot be read. renameEntity
// writes it before its first change and deletes it after its reindex.
function renameMarker(root) {
  const file = path.join(root, RENAME_MARKER);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(safeRead(file, root));
  } catch {
    return null;
  }
}

// rename --prose: the chapter prose edits for the new name (see
// proseRenames), after refusing a kind with no name in prose and a new name
// that is already another entity's, which would merge the two in the text.
function planProseRename(project, kind, id, name) {
  if (!MENTION_KINDS.includes(kind)) {
    throw usageError(`--prose does not apply to a ${kind}: it renames a character, location, faction, artifact, system, or term in chapter prose`);
  }
  const found = proseRenames(project, kind, id, name);
  if (found.clash) {
    const { clash } = found;
    throw refusedError(`"${clash.name}" is already a name of ${clash.kind} ${clash.id}, so --prose would give two entities one name in the text; choose another name, or rename without --prose`);
  }
  const warnings = found.shared.length === 0 ? [] : [warn("prose-name-shared", `--prose left ${found.shared.length} ${found.shared.length === 1 ? "name" : "names"} that ${kind} ${id} shares with another entity as written: ${found.shared.map((entry) => `${entry.file}:${entry.line}:${entry.column}`).join(", ")}. Check them`)];
  return { ...found, warnings };
}

const SERIES_CANON_COLLECTIONS = {
  character: "characters",
  location: "locations",
  system: "systems",
  faction: "factions",
  artifact: "artifacts",
  term: "glossaryTerms"
};

// `story series` matches shared canon by id, so renaming an id that a linked
// book also defines detaches the entity from every cross-book check.
function linkedBookIdWarnings(project, kind, oldId, newId) {
  const collection = SERIES_CANON_COLLECTIONS[kind];
  const data = project.story.data ?? {};
  const root = project.root;
  if (!collection || (seriesLinks(root, data, "follows").length === 0 && seriesLinks(root, data, "precedes").length === 0)) {
    return [];
  }
  const own = canonicalPath(root);
  const { books } = discoverSeriesBooks(root, scanProject);
  return books
    .filter((book) => book.key !== own && book.project[collection].some((entity) => entity.id === oldId))
    .map((book) => warn("linked-book-id", `${kind} ${oldId} is also defined in linked book ${book.title} (${seriesLinkPath(root, book.root)}); story series matches shared canon by id, so rename it there to ${newId} too, or keep the old id`));
}

// Updates the first heading that shows the old name (`# Old Name`, or
// `# Chapter 3: Old Name`) so the file body matches its new frontmatter.
function retitleHeading(markdown, oldName, newName) {
  const oldText = String(oldName ?? "").trim();
  const match = FRONTMATTER_PATTERN.exec(markdown);
  const header = match ? match[0] : "";
  const body = markdown.slice(header.length);
  const heading = new RegExp(`^(#[ \\t]+(?:Chapter \\d+:[ \\t]+)?)${escapeRegExp(oldText)}([ \\t]*)(?=\\r?$)`, "m");
  return `${header}${body.replace(heading, (whole, prefix, trailing) => `${prefix}${newName}${trailing}`)}`;
}

export function removeEntity(root, options) {
  return withUndo(root, ["remove", options.kind, options.id], () => removeNow(root, options));
}

function removeNow(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "remove");
  const kind = normalizeKind(options.kind);
  const id = String(options.id ?? "").trim();
  if (!id) {
    throw usageError("remove requires an entity id");
  }

  const config = entityConfig(kind);
  const file = path.join(project.root, config.dir, `${id}.md`);
  requireKebabId(id, `${kind} id`);
  assertSafeProjectPath(file, project.root);
  // A file already deleted by hand (or lost in a merge) can leave references
  // behind; remove still scrubs them, so a later entity with this id does
  // not silently adopt them. With no file and no references, the id is
  // simply unknown.
  const alreadyGone = !fs.existsSync(file);
  if (alreadyGone && removeEntityReferences(project.root, kind, id, new Map()).size === 0) {
    throw usageError(`${kind} ${id} does not exist`);
  }

  if (kind === "chapter") {
    // A scene's chapter is required, so scrubbing it would leave the scene
    // invalid; the scenes go first.
    const scenes = project.scenes.filter((scene) => scene.chapter === id);
    if (scenes.length > 0) {
      throw refusedError(`chapter ${id} still has scenes: ${scenes.map((scene) => scene.id).join(", ")}. Remove them first with story remove scene <id>`);
    }
  }

  if (kind === "chapter") {
    // An empty died-in, since, or learned-in means "before the story", so
    // clearing them would move a death, a loss, or a discovery to before
    // chapter 1. A progression's `from` is matched too (transformReferences
    // reads it for any chapter context): dropping the entry would lose the
    // change it records.
    const context = { ...entityReferenceContext(project.root, "chapter", id), isReferenceKey: (key) => BEFORE_STORY_FIELDS.includes(key) };
    const named = [...planReferenceRewrites(project.root, context, new Map([[file, null]]), idRenamer(id, `${id}-removed`), (body) => body).keys()];
    if (named.length > 0) {
      throw refusedError(`chapter ${id} is still named by ${BEFORE_STORY_FIELDS.join(", ")}, or a progression's from in ${named.map((entry) => projectPath(project.root, entry)).join(", ")}; an empty value there means before the story, and a progression needs the chapter it starts in, so point them at another chapter first`);
    }
  }

  // Dropping the choices that led here can leave a chapter with none, which
  // makes it an ending, so remove says which chapters lost one.
  const choosers = kind === "chapter"
    ? project.chapters.filter((chapter) => chapter.id !== id && chapterChoices(chapter, "").choices.some((choice) => choice.to === id)).map((chapter) => relative(project, chapter.file))
    : [];
  const wasBranching = choosers.length > 0 && branchGraph(project).branching;
  const plan = removeEntityReferences(project.root, kind, id, new Map([[file, null]]));
  assertWritable(project.root, [...plan.keys(), file]);
  // An edit saved after this read keeps the file.
  const original = alreadyGone ? undefined : readTextFile(file);
  // References first, the file last, so an interrupted remove can be rerun.
  commitWrites(() => {
    writeReferencePlan(project.root, plan);
    removeFile(file, { force: true, root: project.root, unchangedFrom: original });
  });
  const reindexed = reindexProject(project.root);
  // remove never rewrites story.md's frontmatter, so its queries are as
  // scanned.
  const warnings = leftoverReferenceWarnings(project.root, kind, id, project.story.data.queries);
  if (choosers.length > 0) {
    // With the last choice gone the book is linear again: every chapter
    // continues to the next, endings included.
    warnings.push(warn("choices-dropped", branchGraph(scanProject(project.root)).branching || !wasBranching
      ? `${choosers.join(", ")} had choices leading to ${id}, which remove dropped; a chapter left with no choices is an ending, so check where ${choosers.length === 1 ? "it leads" : "they lead"} now`
      : `${choosers.join(", ")} had the last choices in the book, leading to ${id}, which remove dropped; with no choices left the book is linear again and each chapter continues to the next, so add choices back to keep it branching`, choosers.length === 1 ? choosers[0] : null));
  }
  return { kind, id, file, alreadyGone, changed: [file].concat(reindexed.changed), warnings };
}

// What remove leaves for the author: body links and bare chapter or scene ids
// (the ones `story links` checks, plus links in a registry's own sections),
// which it never edits; story.md `queries` filters naming the id; exemption
// patterns naming it, which no longer match anything; and references another
// kind's entity with the id may mean (see ambiguousReferenceWarnings).
function leftoverReferenceWarnings(root, kind, id, queries) {
  const warnings = [];
  const context = entityReferenceContext(root, kind, id);
  const probe = `${id}-leftover-probe`;
  const numbered = kind === "chapter" || kind === "scene";
  let files = [];
  let ambiguous = [];
  try {
    files = [...planReferenceRewrites(root, context, new Map(), (value) => value, (body, file) => {
      const relinked = renameLinkTargets(root, file, body, context, probe);
      return numbered ? renameIdTokens(root, file, relinked, id, probe) : relinked;
    }).keys()].map((file) => projectPath(root, file)).sort();
    ambiguous = ambiguousReferenceWarnings(root, kind, id, context.entityFile);
  } catch {
    // Every file parsed before the remove; a file broken since is reported
    // by validate.
  }
  if (files.length > 0) {
    warnings.push(warn("leftover-references", `${files.join(", ")} still ${files.length === 1 ? "mentions" : "mention"} ${kind} ${id} in ${numbered ? "links or ids" : "links"} in the text, which remove does not change: edit ${files.length === 1 ? "it" : "them"}, then run story links`, files.length === 1 ? files[0] : null));
  }
  const stale = exemptionEntries(root)
    .map(({ entry, index }) => {
      const followed = followExemptionEntry(entry, kind, id, probe);
      return { index, keys: EXEMPTION_TEXT_KEYS.filter((key) => followed[key] !== entry[key]).map((key) => `${key} ${JSON.stringify(entry[key])}`) };
    })
    .filter(({ keys }) => keys.length > 0);
  const named = queryFiltersNaming(queries, context.isReferenceKey, id);
  if (named.length > 0) {
    const listed = named.map((entry) => `${shownQuery(entry)} (${entry.positions.map((position) => shownFilter(entry.item.where[position])).join(", ")})`).join(", ");
    warnings.push(warn("stale-query", `story.md ${named.length === 1 ? "query" : "queries"} ${listed} still ${named.length === 1 ? "filters" : "filter"} on ${kind} ${id}, which remove does not change: update or delete ${named.length === 1 ? "that filter" : "those filters"}`, "story.md"));
  }
  if (stale.length > 0) {
    const values = stale.flatMap(({ keys }) => keys);
    warnings.push(warn("stale-exemption", `continuity/exemptions.md has ${stale.length === 1 ? "an entry" : `${stale.length} entries`} naming ${id} (${stale.map(({ index }) => `exemptions[${index}]`).join(", ")}), which ${stale.length === 1 ? "no longer matches" : "no longer match"} anything: ${values.join(", ")}. Delete or update ${stale.length === 1 ? "it" : "them"}`, EXEMPTIONS_FILE));
  }
  return warnings.concat(ambiguous);
}

const BEFORE_STORY_FIELDS = ["died-in", "since", "learned-in"];

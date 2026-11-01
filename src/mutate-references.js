// Entity references the mutation commands rewrite: reference fields and
// links, bare chapter and scene ids, exemption entries, and backlinks.
import fs from "node:fs";
import path from "node:path";
import { idText } from "./continuity.js";
import { FRONTMATTER_PATTERN, parseFrontmatter, replaceFrontmatter } from "./frontmatter.js";
import {
  assertSafeProjectPath,
  lstatIfExists,
  projectPath,
  readTextFile,
  writeFile
} from "./files.js";
import { escapeRegExp } from "./markdown.js";
import { warn } from "./findings.js";
import { EXEMPTIONS_FILE, exemptionFile } from "./exemptions.js";
import { queryFiltersNaming, retargetFilter } from "./list.js";
import { projectError, usageError } from "./exit-codes.js";
import {
  INDEX_SCHEMAS,
  MATTER_DIR,
  RESEARCH_DIR,
  mapOutsideLinks,
  entityConfig,
  MULTI_KIND_REFERENCE_FIELDS,
  isKebabId,
  LINK_DEFINITION_PATTERN,
  REGISTRY_HINT,
  markdownFiles,
  MAX_SCAN_FILE_BYTES,
  MAX_SCAN_FILES,
  readMarkdown,
  ENTITY_SCAN_DIRS,
  SOURCE_ROOT_FILES,
  asArray
} from "./scan.js";

// Kinds that share a reference field with `kind` (owner and controlled-by
// name a character or a faction; mentions a character or an artifact).
function kindsSharingFields(kind) {
  const shared = new Map();
  for (const [field, kinds] of Object.entries(REFERENCE_FIELD_KINDS)) {
    if (!kinds.includes(kind)) {
      continue;
    }
    for (const other of kinds) {
      if (other !== kind) {
        shared.set(other, (shared.get(other) ?? []).concat(field));
      }
    }
  }
  return shared;
}

// An id already used by a kind that shares a reference field would make
// those references ambiguous, and rename and remove skip ambiguous
// references, so a later rename or its undo would leave them on the other
// entity, with only a warning.
export function assertUnambiguousId(root, kind, id) {
  for (const [other, fields] of kindsSharingFields(kind)) {
    if (fs.existsSync(path.join(root, entityConfig(other).dir, `${id}.md`))) {
      throw usageError(`${id} is already a ${other} id, and ${fields.join(" and ")} references could not tell the ${kind} from the ${other}. Choose another name, or pass --id`);
    }
  }
}

// A field that can name another kind too (mentions, owner, controlled-by)
// is left alone by rename and remove when an entity of that kind has the
// same id, since the reference could mean either. Lists each file that holds
// such references, with the fields they are in, so the writer can check
// which entity each one meant; `newId` is the rename's new id, or null for a
// remove. Values match as rename and remove match them, so an unquoted
// `owner: 1984` counts.
export function ambiguousReferenceWarnings(root, kind, id, excludedFile, newId = null) {
  const warnings = [];
  const probe = `${id}-ambiguous-probe`;
  for (const [other, fields] of kindsSharingFields(kind)) {
    if (!fs.existsSync(path.join(root, entityConfig(other).dir, `${id}.md`))) {
      continue;
    }
    const found = new Map();
    for (const field of fields) {
      const context = { ...entityReferenceContext(root, kind, id), isReferenceKey: (key) => key === field };
      const plan = planReferenceRewrites(root, context, new Map([[excludedFile, null]]), (value) => (idText(value) === id ? probe : value), (body) => body);
      for (const file of plan.keys()) {
        const shown = projectPath(root, file);
        found.set(shown, (found.get(shown) ?? []).concat(field));
      }
    }
    if (found.size === 0) {
      continue;
    }
    const files = [...found.keys()].sort();
    const listed = files.map((file) => `${file} (${found.get(file).join(", ")})`).join(", ");
    const action = newId === null ? `remove left them alone, so they now name the ${other}: delete any that meant the ${kind}` : `rename left them alone, so they now name the ${other}: change any that meant the ${kind} to ${newId}`;
    warnings.push(warn("ambiguous-references", `references to ${id} in ${listed} could mean the ${kind} or ${other} ${id}, and ${action}`, files.length === 1 ? files[0] : null));
  }
  return warnings;
}

// The exemption keys that name ids and paths as text: a pattern quotes
// finding text, file is a path, and chapter is a chapter id.
export const EXEMPTION_TEXT_KEYS = ["pattern", "file", "chapter"];

// The mapping entries of the exemptions log, with their indexes.
export function exemptionEntries(root) {
  const filePath = path.join(root, EXEMPTIONS_FILE);
  try {
    const entries = readMarkdown(filePath, root).data.exemptions;
    return Array.isArray(entries)
      ? entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry && typeof entry === "object" && !Array.isArray(entry))
      : [];
  } catch {
    return [];
  }
}

// An exemption entry with the ids of a renamed or moved `kind` entity
// changed. A pattern changes wherever it names the id as a whole token, as
// it quotes finding text. A file changes only when it is that entity's own
// file (or, for a chapter, one of its scene files), so a location sharing a
// character's id keeps its path. `chapter` is a reference field, so the
// reference rewrites already follow a moved chapter and scrub a removed
// one; here it follows a scene the entry names to its new chapter.
export function followExemptionEntry(entry, kind, oldId, newId) {
  const renamed = { ...entry };
  if (typeof entry.pattern === "string") {
    renamed.pattern = renameIdText(entry.pattern, oldId, newId);
  }
  const file = typeof entry.file === "string" ? exemptionFile(entry.file) : null;
  const dir = entityConfig(kind).dir.replace(/\\/g, "/");
  const ownScene = kind === "chapter" && file !== null && new RegExp(`^scenes/${escapeRegExp(oldId)}-scene-\\d+\\.md$`).test(file);
  if (file !== null && (file === `${dir}/${oldId}.md` || ownScene)) {
    renamed.file = renameIdText(file, oldId, newId);
  }
  const sceneChapter = (id) => /^(.+)-scene-\d+$/.exec(id)?.[1];
  if (kind === "scene" && renamed.file !== entry.file && entry.chapter === sceneChapter(oldId) && sceneChapter(newId) !== undefined) {
    renamed.chapter = sceneChapter(newId);
  }
  return renamed;
}

// Exemption patterns quote finding text, which names ids and file paths
// (`chapters/chapter-01.md has POV ann`), and file and chapter keys name
// them outright. When rename or move changes an id, the entries naming it
// follow, so a dismissal stays with its finding instead of resurfacing, or
// later dismissing whatever takes the old id.
export function followExemptionPatterns(root, plan, kind, oldId, newId) {
  const filePath = path.join(root, EXEMPTIONS_FILE);
  if (!plan.has(filePath) && !lstatIfExists(filePath)) {
    return;
  }
  const text = plan.get(filePath) ?? readTextFile(filePath);
  // The plan already parsed it: a broken exemptions file stops the command.
  const data = parseFrontmatter(text, filePath).data;
  if (!Array.isArray(data.exemptions)) {
    return;
  }
  let changed = false;
  const exemptions = data.exemptions.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    const renamed = followExemptionEntry(entry, kind, oldId, newId);
    changed ||= EXEMPTION_TEXT_KEYS.some((key) => renamed[key] !== entry[key]);
    return renamed;
  });
  if (changed) {
    if (!plan.has(filePath)) {
      plan.originals?.set(filePath, text);
    }
    plan.set(filePath, replaceFrontmatter(text, { ...data, exemptions }));
  }
}

// Saved story.md queries filter on ids (`pov=mara-quill`), so when rename,
// move, or merge changes an id, the filters comparing a key that can name
// the entity with the old id follow it, as its frontmatter references do;
// the rest of each filter stays as written. No key names a scene, so a scene
// move has none to follow.
export function followQueryFilters(root, plan, kind, oldId, newId) {
  const filePath = path.join(root, "story.md");
  const text = plan.get(filePath) ?? readTextFile(filePath);
  // The plan already parsed it: a broken story.md stops the command.
  const data = parseFrontmatter(text, filePath).data;
  const found = queryFiltersNaming(data.queries, entityReferenceContext(root, kind, oldId).isReferenceKey, oldId);
  if (found.length === 0) {
    return;
  }
  const queries = [...data.queries];
  for (const { index, item, positions } of found) {
    queries[index] = { ...item, where: item.where.map((filter, position) => (positions.includes(position) ? retargetFilter(filter, newId) : filter)) };
  }
  if (!plan.has(filePath)) {
    plan.originals?.set(filePath, text);
  }
  plan.set(filePath, replaceFrontmatter(text, { ...data, queries }));
}

// The files besides `excludedFile` (when not null) that already reference
// `id` (a scheduled chapter, a planned character, a link left by remove): an
// entity given that id takes them over. `rename` finds bare ids, and
// `narrow` can leave some references out (withoutChoices).
export function adoptedReferenceFiles(root, kind, id, excludedFile, rename = renameIdText, narrow = (context) => context) {
  const context = narrow(entityReferenceContext(root, kind, id));
  const probe = `${id}-adopted-probe`;
  const numbered = kind === "chapter" || kind === "scene";
  const plan = planReferenceRewrites(root, context, new Map(excludedFile === null ? [] : [[excludedFile, null]]), idRenamer(id, probe), (body, file) => {
    const relinked = renameLinkTargets(root, file, body, context, probe);
    return numbered ? renameIdTokens(root, file, relinked, id, probe, rename) : relinked;
  });
  return [...plan.keys()].map((file) => projectPath(root, file)).sort();
}

// Before a rename or move gives an entity `id`, warns about the references
// it takes over. `action` names the command: rename, move, or split or merge,
// which move chapters and scenes as move does. Only a warning, since an
// interrupted run that is rerun leaves the same references.
export function adoptedReferenceWarnings(root, kind, id, excludedFile, action) {
  const files = adoptedReferenceFiles(root, kind, id, excludedFile);
  if (files.length === 0) {
    return [];
  }
  return [warn("adopted-references", `${id} was already referenced before this ${action}, and those references now point at the ${action === "rename" ? "renamed" : "moved"} ${kind}: ${files.join(", ")}. Check them`)];
}

// links lets an abandoned promise, clue, or question keep the chapter-NN it
// was planned for, so a new chapter with that id adopts the cut thread. move
// and rename report every adopted reference; add chapter and split's new
// chapter report these (split refuses any other reference to the id).
export function abandonedThreadFiles(project, chapterId) {
  return [...project.promises, ...project.clues, ...project.questions]
    .filter((entry) => entry.status === "abandoned" && [entry.planted, entry.payoff, entry.introduced].includes(chapterId))
    .map((entry) => projectPath(project.root, entry.file))
    .sort();
}

export function abandonedThreadWarnings(project, chapterId) {
  const files = abandonedThreadFiles(project, chapterId);
  if (files.length === 0) {
    return [];
  }
  return [warn("adopted-references", `${chapterId} was already named by abandoned threads, and those references now point at the new chapter: ${files.join(", ")}. Clear them if the cut threads do not belong there`)];
}

export function idRenamer(oldId, newId) {
  return (value) => (value === oldId ? newId : value);
}

// Bare chapter and scene ids in plot/timeline.md and arc bodies, which links
// checks, and in the plot/_index.md theme tracking table follow the move. `chapter-03` never matches inside `chapter-03-scene-01`
// unless the whole scene id is the one moving, and scene ids of a moved chapter
// (`chapter-03-scene-02`) follow it too.
// The registries whose bodies hold bare ids that people write.
export const ID_TOKEN_REGISTRIES = new Set(["plot/timeline.md", "plot/_index.md"]);

export function renameIdTokens(root, file, body, oldId, newId, rename = renameIdText) {
  const relativePath = projectPath(root, file);
  if (!ID_TOKEN_REGISTRIES.has(relativePath) && path.posix.dirname(relativePath) !== "plot/arcs") {
    return body;
  }
  // Link destinations were already handled by renameLinkTargets, and a URL
  // or a path into another book is not this book's id.
  return mapOutsideLinks(body, (text) => rename(text, oldId, newId));
}

// Replaces whole-token chapter id `oldId` in text, but not the scene ids
// that start with it.
export function renameChapterIdText(text, oldId, newId) {
  return text.replace(new RegExp(`(?<![\\w-])${escapeRegExp(oldId)}(?![\\w-])`, "g"), newId);
}

// Replaces whole-token `oldId` in text, and the scene ids of a chapter id.
function renameIdText(text, oldId, newId) {
  return text
    .replace(new RegExp(`(?<![\\w-])${escapeRegExp(oldId)}-scene-(\\d+)(?![\\w-])`, "g"), `${newId}-scene-$1`)
    .replace(new RegExp(`(?<![\\w-])${escapeRegExp(oldId)}(?![\\w-])`, "g"), newId);
}

// Frontmatter keys whose values are entity ids, mapped to the entity kinds
// each key may point at. rename and remove touch only these keys (and only
// when the key can point at the kind being changed) plus markdown link targets
// that resolve to the entity's file, never prose or unrelated fields such as
// status or tense that may happen to equal an id.
export const REFERENCE_FIELD_KINDS = {
  arc: ["arc"],
  arcs: ["arc"],
  "arcs-advanced": ["arc"],
  artifact: ["artifact"],
  chapter: ["chapter"],
  character: ["character"],
  characters: ["character"],
  "controlled-by": MULTI_KIND_REFERENCE_FIELDS["controlled-by"],
  "died-in": ["chapter"],
  "revived-in": ["chapter"],
  introduced: ["chapter"],
  "learned-in": ["chapter"],
  "used-in": ["chapter"],
  location: ["location"],
  locations: ["location"],
  members: ["character"],
  mentions: MULTI_KIND_REFERENCE_FIELDS.mentions,
  "notable-characters": ["character"],
  owner: MULTI_KIND_REFERENCE_FIELDS.owner,
  payoff: ["chapter"],
  planted: ["chapter"],
  pov: ["character"],
  resolved: ["chapter"],
  since: ["chapter"],
  // A scene's state-changes `target` names the artifact the prop custody
  // check follows.
  target: ["artifact"]
};

// Nested mapping lists whose entries are identified by one reference key.
// Removing the entity named by that key drops the whole entry; removing an
// entity named by any other key only clears that field.
const ENTRY_IDENTITY_FIELDS = {
  relationships: "character",
  "character-state": "character",
  "knowledge-state": "character",
  "object-state": "artifact",
  // A progression takes effect from a chapter; see transformReferences.
  progressions: "from",
  routes: "to",
  distances: "to",
  choices: "to"
};

// The kind a nested `to` names, by the list it sits in: a location's route
// or distance leads to a location, a chapter's choice to a chapter.
export const NESTED_TO_KINDS = { routes: "location", distances: "location", choices: "chapter" };

// Describes the entity being renamed or removed. A frontmatter key counts as
// a reference to it only when the key can point at its kind. A key that may
// point at several kinds (owner, controlled-by, mentions) is left alone when
// another of those kinds has an entity with the same id, because the
// reference is then ambiguous (see ambiguousReferenceWarnings).
export function entityReferenceContext(root, kind, id) {
  const otherExists = new Map();
  const existsAs = (other) => {
    if (!otherExists.has(other)) {
      otherExists.set(other, fs.existsSync(path.join(root, entityConfig(other).dir, `${id}.md`)));
    }
    return otherExists.get(other);
  };
  return {
    id,
    kind,
    entityFile: path.resolve(root, entityConfig(kind).dir, `${id}.md`),
    isReferenceKey: (key, listKey = null) => {
      if (key === "to") {
        return listKey !== null && Object.hasOwn(NESTED_TO_KINDS, listKey) && NESTED_TO_KINDS[listKey] === kind;
      }
      const kinds = Object.hasOwn(REFERENCE_FIELD_KINDS, key) ? REFERENCE_FIELD_KINDS[key] : [];
      return kinds.includes(kind) && !kinds.some((other) => other !== kind && existsAs(other));
    }
  };
}

// Resolves a markdown link target in `file` to an absolute path, or null for
// external links and bare anchors.
export function resolveLinkTarget(root, file, target) {
  const cleaned = String(target).trim().split(/\s+/)[0].replace(/^<|>$/g, "").split("#")[0].split("?")[0];
  // A URL with a scheme, or a protocol-relative one, is not a project file.
  if (cleaned === "" || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(cleaned)) {
    return null;
  }
  let decoded = cleaned;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    decoded = cleaned;
  }
  return decoded.startsWith("/")
    ? path.resolve(root, `.${decoded}`)
    : path.resolve(path.dirname(file), decoded);
}

export function renameLinkTargets(root, file, body, context, newId) {
  const retarget = (target) => target.replace(new RegExp(`(^|/|<)${escapeRegExp(context.id)}\\.md(?=$|[#?>\\s])`), `$1${newId}.md`);
  return body.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, (match, text, target) => {
    if (resolveLinkTarget(root, file, target) !== context.entityFile) {
      return match;
    }
    const nextText = text === context.id ? newId : text;
    return `[${nextText}](${retarget(target)})`;
  }).replace(LINK_DEFINITION_PATTERN, (match, open, label, target) => {
    if (resolveLinkTarget(root, file, target) !== context.entityFile) {
      return match;
    }
    return `${match.slice(0, match.length - target.length)}${retarget(target)}`;
  });
}

export function replaceEntityReferences(root, kind, oldId, newId, overrides) {
  const context = entityReferenceContext(root, kind, oldId);
  return planReferenceRewrites(root, context, overrides,
    (value) => (idText(value) === oldId ? newId : value),
    (body, file) => renameLinkTargets(root, file, body, context, newId));
}

export function removeEntityReferences(root, kind, id, overrides) {
  const context = entityReferenceContext(root, kind, id);
  return planReferenceRewrites(root, context, overrides, (value) => (idText(value) === id ? null : value), (body) => body);
}

// Reads and rewrites every markdown file in memory before anything is written,
// so an unparsable file aborts the command with the project untouched. Returns
// a Map of file path to new contents; `overrides` supplies in-memory contents
// for files that are about to change (or null for files about to be deleted).
export function planReferenceRewrites(root, context, overrides, transform, transformBody) {
  const plan = new Map();
  // The text each rewrite was planned from, so a file saved meanwhile is not
  // overwritten.
  plan.originals = new Map();
  const storyFile = path.join(root, "story.md");
  let otherFiles = 0;
  for (const file of markdownFiles(root, { maxFiles: Infinity })) {
    const override = overrides?.has(file) ? overrides.get(file) : undefined;
    if (override === null) {
      continue;
    }
    const sourceFile = isProjectSourceFile(root, file);
    let text = override;
    if (text === undefined) {
      assertSafeProjectPath(file, root);
      // Notes outside the project model past the scan limits (an oversized
      // clipping, a huge research dump) are skipped, as validate ignores them.
      if (!sourceFile) {
        otherFiles += 1;
        if (otherFiles > MAX_SCAN_FILES || fs.lstatSync(file).size > MAX_SCAN_FILE_BYTES) {
          continue;
        }
      }
      text = readTextFile(file);
      plan.originals.set(file, text);
    }
    const match = FRONTMATTER_PATTERN.exec(text);
    if (!match && sourceFile) {
      throw projectError(`${projectPath(root, file)} is missing YAML frontmatter${registryHint(root, file)}; nothing was changed`);
    }
    let header = "";
    let body = text;
    if (match) {
      header = match[0];
      body = text.slice(match[0].length);
      // story.md pov is a narrative mode (first, third-limited), not an id.
      if (file !== storyFile) {
        let data = null;
        try {
          data = parseFrontmatter(text, file).data;
        } catch (error) {
          // A note outside the project model may use YAML the CLI does not
          // parse; only its body links are rewritten.
          if (sourceFile) {
            throw projectError(`${projectPath(root, file)}: ${error.message}${registryHint(root, file)}; nothing was changed`);
          }
        }
        if (data !== null) {
          let nextData = transformReferences(data, transform, context);
          if (context.kind === "chapter") {
            nextData = reconcileChapterStatuses(data, nextData);
          }
          if (JSON.stringify(nextData) !== JSON.stringify(data)) {
            header = replaceFrontmatter(header, nextData);
          }
        }
      }
    }
    const next = `${header}${transformBody(body, file)}`;
    if (next !== text || override !== undefined) {
      plan.set(file, next);
    }
  }
  return plan;
}

// Entity files and registries always carry frontmatter, so one without it is
// broken and must not be skipped. Other markdown (a README, drafts) may be
// plain.
// Only entity files, registries, and the fixed project files count: notes
// a skill keeps beside them (continuity/motifs.md, continuity/theme-audit.md)
// may be plain markdown.
const FRONTMATTER_FILES = new Set([
  "plot/timeline.md",
  "continuity/state.md",
  "continuity/exemptions.md"
]);

// The registries the CLI writes; an `_index.md` elsewhere (a notes site,
// say) may be plain markdown.
export const REGISTRY_FILES = new Set([
  ...INDEX_SCHEMAS.map(([relativePath]) => relativePath),
  path.posix.join(MATTER_DIR, "_index.md"),
  path.posix.join(RESEARCH_DIR, "_index.md")
]);

// Registries are generated, so a damaged one is rebuilt rather than fixed.
function registryHint(root, file) {
  return REGISTRY_FILES.has(projectPath(root, file)) ? REGISTRY_HINT : "";
}

function isProjectSourceFile(root, file) {
  const relativePath = projectPath(root, file);
  return SOURCE_ROOT_FILES.has(relativePath)
    || FRONTMATTER_FILES.has(relativePath)
    || REGISTRY_FILES.has(relativePath)
    || ENTITY_SCAN_DIRS.includes(path.posix.dirname(relativePath));
}

// Clearing a removed chapter from a promise, clue, or question also walks
// back a status that claimed the cleared chapter had happened.
function reconcileChapterStatuses(before, after) {
  const next = { ...after };
  if (before.planted && !next.planted && (next.status === "planted" || next.status === "paid-off")) {
    next.status = "planned";
  }
  if (before.payoff && !next.payoff && next.status === "paid-off") {
    next.status = "planted";
  }
  if (before.resolved && !next.resolved && (next.status === "answered" || next.status === "resolved")) {
    next.status = "open";
  }
  return next;
}

function transformReferences(data, transform, context, identityKey = null, listKey = null) {
  const next = {};
  // A `__proto__:` key is kept as an own property, as the parser keeps it.
  const set = (key, value) => Object.defineProperty(next, key, { value, enumerable: true, configurable: true, writable: true });
  // A route's or distance's `to` names a location and a choice's `to` a chapter; `to`
  // anywhere else is left alone. A progression's `from` names a chapter, and
  // its `value` is a reference when the field it changes is one (a
  // character's arc, a location's controlled-by).
  const progression = identityKey === "from";
  const isReference = (key) => (progression && key === "value" ? typeof data.field === "string" && context.isReferenceKey(data.field) : context.isReferenceKey(key, listKey))
    || (key === "from" && progression && context.kind === "chapter");
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const items = [];
      const childIdentity = Object.hasOwn(ENTRY_IDENTITY_FIELDS, key) ? ENTRY_IDENTITY_FIELDS[key] : null;
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const mapped = transformReferences(item, transform, context, childIdentity, key);
          if (mapped !== null) {
            items.push(mapped);
          }
        } else if (isReference(key)) {
          const mapped = transform(item);
          if (mapped !== null) {
            items.push(mapped);
          }
        } else {
          items.push(item);
        }
      }
      set(key, items);
      continue;
    }

    if (isReference(key)) {
      const mapped = transform(value);
      if (mapped === null) {
        // A removed id that identifies a nested entry (a relationship's
        // character, a state entry's character or artifact) drops the whole
        // entry; any other reference field is cleared in place, a
        // progression's value included, so the change stays on record.
        if (identityKey !== null && key === identityKey) {
          return null;
        }
        set(key, "");
        continue;
      }
      set(key, mapped);
      continue;
    }

    set(key, value);
  }
  return next;
}

export function applyEntityBacklinks(root, kind, id, data) {
  if (kind === "location") {
    for (const characterId of asArray(data["notable-characters"])) {
      if (isKebabId(characterId)) {
        addFrontmatterListValue(root, `characters/${characterId}.md`, "locations", id);
      }
    }
  }

  if (kind === "scene" && isKebabId(data.chapter)) {
    // The chapter lists everyone and everywhere its scenes use; continuity
    // warns when it does not. Unknown ids stay on the scene only, where
    // links reports them once.
    const chapterFile = `chapters/${data.chapter}.md`;
    const exists = (dir, id) => fs.existsSync(path.join(root, dir, `${id}.md`));
    if (isKebabId(data.location) && exists("worldbuilding/locations", data.location)) {
      addFrontmatterListValue(root, chapterFile, "locations", data.location);
    }
    const chapterPath = path.join(root, chapterFile);
    const mentions = fs.existsSync(chapterPath) ? asArray(readMarkdown(chapterPath, root).data.mentions) : [];
    for (const characterId of asArray(data.characters)) {
      if (isKebabId(characterId) && exists("characters", characterId) && !mentions.includes(characterId)) {
        addFrontmatterListValue(root, chapterFile, "characters", characterId);
      }
    }
  }

  if (kind === "character") {
    for (const locationId of asArray(data.locations)) {
      if (isKebabId(locationId)) {
        addFrontmatterListValue(root, path.join("worldbuilding", "locations", `${locationId}.md`), "notable-characters", id);
      }
    }
  }
}

function addFrontmatterListValue(root, relativePath, field, value) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath) || !value) {
    return;
  }

  assertSafeProjectPath(filePath, root);
  const markdown = readMarkdown(filePath, root);
  const list = asArray(markdown.data[field]);
  if (!list.includes(value)) {
    writeFile(filePath, replaceFrontmatter(markdown.rawMarkdown, {
      ...markdown.data,
      [field]: list.concat(value)
    }), { root, unchangedFrom: markdown.rawMarkdown });
  }
}

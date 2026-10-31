// story add: option checks and the new entity's file, backlinks, and registry.
import fs from "node:fs";
import path from "node:path";
import { projectPath, readTextFile, writeFile } from "./files.js";
import { optionValues } from "./options.js";
import { CHAPTER_HOOKS, SCENE_OUTCOMES } from "./pacing.js";
import { warn } from "./findings.js";
import { refusedError, usageError } from "./exit-codes.js";
import {
  CHARACTER_ROLES,
  CHARACTER_STATUSES,
  ARC_TYPES,
  ARC_STATUSES,
  CHAPTER_STATUSES,
  DRAFT_MODES,
  SCENE_STATUSES,
  FACTION_TYPES,
  FACTION_STATUSES,
  ARTIFACT_TYPES,
  ARTIFACT_STATUSES,
  QUESTION_STATUSES,
  PROMISE_STATUSES,
  CLUE_STATUSES,
  TERM_CATEGORIES,
  MATTER_PLACEMENTS,
  RESEARCH_STATUSES,
  RESEARCH_ACCURACY,
  RESEARCH_CONFIDENCE,
  RESEARCH_METHODS,
  scanProject,
  assertProjectParses,
  canonicalChapterId,
  mayScheduleChapter,
  requireSingleLineName,
  buildEntity,
  entityConfig,
  normalizeKind,
  assertPortableId,
  isKebabId,
  nextSceneNumber,
  readMarkdown,
  safeRead,
  asArray,
  relative
} from "./scan.js";
import {
  assertUnambiguousId,
  abandonedThreadWarnings,
  REFERENCE_FIELD_KINDS,
  REGISTRY_FILES,
  applyEntityBacklinks
} from "./mutate-references.js";
import { reindexProject } from "./mutate-maintenance.js";

const ENTITY_ENUM_OPTIONS = {
  character: [["role", CHARACTER_ROLES], ["status", CHARACTER_STATUSES]],
  faction: [["type", FACTION_TYPES], ["status", FACTION_STATUSES]],
  artifact: [["type", ARTIFACT_TYPES], ["status", ARTIFACT_STATUSES]],
  arc: [["type", ARC_TYPES], ["status", ARC_STATUSES]],
  chapter: [["status", CHAPTER_STATUSES], ["hook", CHAPTER_HOOKS], ["mode", DRAFT_MODES]],
  scene: [["status", SCENE_STATUSES], ["outcome", SCENE_OUTCOMES]],
  question: [["status", QUESTION_STATUSES]],
  promise: [["status", PROMISE_STATUSES]],
  clue: [["status", CLUE_STATUSES]],
  term: [["category", TERM_CATEGORIES]],
  matter: [["placement", MATTER_PLACEMENTS]],
  research: [["status", RESEARCH_STATUSES], ["accuracy", RESEARCH_ACCURACY], ["confidence", RESEARCH_CONFIDENCE], ["method", RESEARCH_METHODS]]
};

function requireEntityEnumOptions(kind, options) {
  for (const [field, allowed] of ENTITY_ENUM_OPTIONS[kind] ?? []) {
    const value = options[field];
    if (value !== undefined && !allowed.has(String(value))) {
      throw usageError(`Unsupported ${kind} ${field} "${value}": expected one of ${[...allowed].join(", ")}`);
    }
  }
}

// Options whose values are entity or chapter ids; a value that is not a
// kebab-case id can never resolve, so add refuses it up front.
const REFERENCE_OPTIONS = ["chapter", "planted", "payoff", "introduced", "resolved", "used-in", "location", "locations", "character", "characters", "mention", "mentions", "member", "members", "owner", "arc", "arcs", "controlled-by"];

const REFERENCE_EXAMPLES = {
  chapter: "chapter-01", planted: "chapter-01", payoff: "chapter-01", introduced: "chapter-01", resolved: "chapter-01", "used-in": "chapter-01",
  location: "port-kestrel", locations: "port-kestrel", arc: "the-long-road", arcs: "the-long-road", "controlled-by": "harbor-council",
  owner: "mara-quill or harbor-council"
};

function assertReferenceOptions(kind, options) {
  for (const option of REFERENCE_OPTIONS) {
    // A character's --arc is its free-text arc theme, not an arc id.
    if (kind === "character" && (option === "arc" || option === "arcs")) {
      continue;
    }
    for (const value of optionValues(options, option)) {
      if (!isKebabId(value)) {
        throw usageError(`--${option} "${value}" must be a kebab-case id (such as ${REFERENCE_EXAMPLES[option] ?? "mara-quill"})`);
      }
    }
  }
  if ((kind === "chapter" || kind === "scene") && options.pov !== undefined && String(options.pov).trim() !== "" && !isKebabId(String(options.pov).trim())) {
    throw usageError(`--pov "${options.pov}" must be a character id (such as mara-quill)`);
  }
}

// Fields that hold one id: a repeated flag cannot fit.
const SCALAR_REFERENCE_OPTIONS = {
  scene: ["chapter", "location", "pov"],
  chapter: ["pov"],
  artifact: ["owner", "location"],
  location: ["controlled-by"],
  promise: ["planted", "payoff"],
  clue: ["planted", "payoff"],
  question: ["introduced", "resolved"]
};

function normalizeScalarOptions(kind, options) {
  const next = { ...options };
  for (const option of SCALAR_REFERENCE_OPTIONS[kind] ?? []) {
    if (options[option] === undefined || options[option] === true) {
      continue;
    }
    const values = optionValues(options, option);
    if (values.length > 1) {
      throw usageError(`--${option} takes one id for ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind}, got ${values.join(", ")}`);
    }
    next[option] = values[0] ?? "";
  }
  return next;
}

const CHAPTER_REFERENCE_OPTIONS = ["chapter", "planted", "payoff", "introduced", "resolved", "used-in"];

// Options that may name a chapter not written yet. A scene's --chapter and a
// question's --resolved must exist, which add reports in their own words.
const SCHEDULED_CHAPTER_OPTIONS = new Set(["planted", "payoff", "introduced", "used-in"]);

// The same rule links applies to scheduled chapters: a chapter not written
// yet is named chapter-NN, chapter-00 never exists, and chapter-1 beside
// chapter-01 is a typo.
function assertChapterReferences(project, options) {
  const byNumber = new Map(project.chapters.map((chapter) => [chapter.number, chapter.id]));
  for (const option of CHAPTER_REFERENCE_OPTIONS) {
    for (const value of optionValues(options, option)) {
      if (project.chapters.some((chapter) => chapter.id === value)) {
        continue;
      }
      const match = /^chapter-(\d+)$/.exec(value);
      if (!match) {
        if (SCHEDULED_CHAPTER_OPTIONS.has(option)) {
          throw usageError(`--${option} ${value} names no chapter: a chapter not written yet must be named chapter-NN, as story add chapter names it`);
        }
        continue;
      }
      const number = Number.parseInt(match[1], 10);
      if (number === 0) {
        throw usageError(`--${option} ${value}: chapter numbers start at 1`);
      }
      if (byNumber.has(number)) {
        throw usageError(`--${option} ${value}: did you mean ${byNumber.get(number)}?`);
      }
      // story add chapter writes chapter-01, so chapter-1 could never resolve.
      if (value !== canonicalChapterId(number)) {
        throw usageError(`--${option} ${value}: did you mean ${canonicalChapterId(number)}?`);
      }
    }
  }
}

const STATUS_CHAPTER_FIELDS = {
  promise: ["planted", "payoff"],
  clue: ["planted", "payoff"],
  question: ["resolved", "introduced"]
};

// A status that says a chapter is on the page needs that chapter written:
// links applies the same rule (mayScheduleChapter), so add refuses what links
// would reject.
function assertStatusChapters(project, kind, options) {
  const fields = STATUS_CHAPTER_FIELDS[kind];
  if (fields === undefined) {
    return;
  }
  const written = (value) => project.chapters.some((chapter) => chapter.id === String(value ?? "").trim());
  const given = (value) => String(value ?? "").trim() !== "";
  // Without --status, a question is answered with --resolved and open
  // without. A promise or clue is then planted only when --planted names a
  // written chapter (createEntity makes it planned otherwise), and planted
  // and planned allow the same unwritten payoff, so planned stands for both.
  const status = String(options.status ?? (kind !== "question" ? "planned" : given(options.resolved) ? "answered" : "open"));
  const article = /^[aeiou]/.test(status) ? "an" : "a";
  const reasons = {
    planted: status === "dropped"
      ? `a dropped ${kind} stays in the book, so its setup must be on the page. Use --status abandoned for a setup that was cut`
      : `${article} ${status} ${kind} needs its planted chapter. Leave --status unset to record it as planned`,
    payoff: `a paid-off ${kind} needs its payoff chapter. Use --status planted until the payoff is drafted`,
    resolved: "a question's resolved chapter must exist. Add --resolved once the answer is drafted",
    introduced: `${article} ${status} question needs its introduced chapter`
  };
  for (const field of fields) {
    if (given(options[field]) && !written(options[field]) && !mayScheduleChapter(kind, field, status)) {
      throw usageError(`--${field} ${String(options[field]).trim()} is not written yet: ${reasons[field]}`);
    }
  }
}

export function createEntity(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "add");
  const kind = normalizeKind(options.kind);
  requireEntityEnumOptions(kind, options);
  assertReferenceOptions(kind, options);
  assertChapterReferences(project, options);
  options = normalizeScalarOptions(kind, options);
  if ((kind === "location" || kind === "system") && options.type !== undefined && String(options.type).trim() === "") {
    throw usageError(`--type cannot be empty: leave it out to use "other"`);
  }
  // A promise or clue planted in a chapter not written yet is still a plan.
  if ((kind === "promise" || kind === "clue") && options.status === undefined && options.planted !== undefined
    && !project.chapters.some((chapter) => chapter.id === String(options.planted).trim())) {
    options = { ...options, status: "planned" };
  }
  assertStatusChapters(project, kind, options);
  const name = String(options.name ?? "").trim();
  if (!name) {
    throw usageError(`A ${kind} name is required`);
  }
  requireSingleLineName(name, kind);

  let entity = buildEntity(project, kind, name, options);
  assertPortableId(entity.id, kind);
  assertUnambiguousId(project.root, kind, entity.id);
  // An add interrupted after writing the entity file (before its backlinks
  // and the reindex) left a file that is exactly what this run writes and
  // that no registry lists yet: a rerun finishes the job. An unnumbered
  // chapter or scene looks at the number the interrupted run took rather than
  // adding a second copy at the next one.
  const interrupted = (candidate) => fs.existsSync(candidate.file)
    && readTextFile(candidate.file) === candidate.markdown
    && !registryLists(project.root, kind, candidate.file);
  const numberOption = { chapter: "number", scene: "scene" }[kind];
  let resumed = false;
  if (numberOption && options[numberOption] === undefined) {
    const taken = kind === "chapter"
      ? project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0)
      : nextSceneNumber(project, entity.id.replace(/-scene-\d+$/, "")) - 1;
    if (taken >= 1) {
      const earlier = buildEntity(project, kind, name, { ...options, [numberOption]: taken });
      if (interrupted(earlier)) {
        entity = earlier;
        resumed = true;
      }
    }
  }
  if (!resumed && fs.existsSync(entity.file)) {
    if (!interrupted(entity)) {
      throw refusedError(`${relative(project, entity.file)} already exists`);
    }
    resumed = true;
  }

  if (!resumed) {
    writeFile(entity.file, entity.markdown, { root: project.root, unchangedFrom: null });
  }
  const data = readMarkdown(entity.file, project.root).data;
  applyEntityBacklinks(project.root, kind, entity.id, data);
  const reindexed = reindexProject(project.root);
  const warnings = missingReferenceWarnings(project.root, kind, data);
  if (kind === "chapter") {
    warnings.push(...abandonedThreadWarnings(project, entity.id));
  }
  return { kind, id: entity.id, file: entity.file, changed: [entity.file].concat(reindexed.changed), resumed, warnings };
}

// Fields whose references add writes a backlink for, by kind.
const BACKLINKED_FIELDS = { character: ["locations"], location: ["notable-characters"], scene: ["location", "characters"] };

// An id in a reference option that names no entity may be a forward
// reference for planning, so add keeps it, but says so: story links reports
// it, and no backlink was written. Chapter fields are left out: a promise
// planted in a chapter not written yet is normal, and scenes check theirs.
function missingReferenceWarnings(root, kind, data) {
  const warnings = [];
  for (const [key, value] of Object.entries(data)) {
    // A character's arc is a free-text theme label, not an arc id.
    if (!Object.hasOwn(REFERENCE_FIELD_KINDS, key) || (kind === "character" && key === "arc")) {
      continue;
    }
    const kinds = REFERENCE_FIELD_KINDS[key].filter((other) => other !== "chapter");
    if (kinds.length === 0) {
      continue;
    }
    for (const item of asArray(value)) {
      const id = typeof item === "string" ? item.trim() : "";
      if (!isKebabId(id) || kinds.some((other) => fs.existsSync(path.join(root, entityConfig(other).dir, `${id}.md`)))) {
        continue;
      }
      const backlink = BACKLINKED_FIELDS[kind]?.includes(key) ? ", so no backlink was written" : "";
      warnings.push(warn("unknown-reference", `${kinds.join(" or ")} ${id} (${key}) does not exist${backlink}; story links reports it until you add it`));
    }
  }
  return warnings;
}

// Whether the registry for this kind links the file (reindex writes the
// link, so an entity added by a finished `story add` is always listed).
function registryLists(root, kind, file) {
  const dir = entityConfig(kind).dir;
  const registry = [dir, path.posix.dirname(dir)].map((entry) => path.posix.join(entry, "_index.md")).find((entry) => REGISTRY_FILES.has(entry));
  const registryPath = registry && path.join(root, registry);
  if (!registryPath || !fs.existsSync(registryPath)) {
    return false;
  }
  const link = projectPath(path.dirname(registryPath), file);
  return safeRead(registryPath, root).includes(`](${link})`);
}

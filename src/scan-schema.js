// The story project format as tables: the schema version, the files and
// folders a project holds, the values each status and type field accepts, and
// the entity kinds with their folders and aliases.
import { PROGRESS_FILE } from "./progress-file.js";
import { usageError } from "./exit-codes.js";

export const STORY_SCHEMA_VERSION = 2;

// Only files are required. Entity folders such as worldbuilding/locations or
// plot/arcs start empty, and git does not keep empty directories, so a fresh
// clone of a new project would otherwise fail validation. Folders that hold a
// registry are implied by that registry file.
export const REQUIRED_PATHS = [
  "story.md",
  "characters/_index.md",
  "worldbuilding/_index.md",
  "plot/_index.md",
  "plot/timeline.md",
  "chapters/_index.md",
  "scenes/_index.md",
  "continuity/state.md",
  "continuity/questions/_index.md",
  "continuity/promises/_index.md",
  "continuity/clues/_index.md",
  "glossary/_index.md"
];

// Every folder init creates; migrate restores any that are missing when it
// upgrades an older schema-version.
export const PROJECT_DIRECTORIES = [
  "characters",
  "worldbuilding/locations",
  "worldbuilding/systems",
  "worldbuilding/factions",
  "worldbuilding/artifacts",
  "plot/arcs",
  "chapters",
  "scenes",
  "continuity/questions",
  "continuity/promises",
  "continuity/clues",
  "glossary/terms"
];

export const INDEX_SCHEMAS = [
  ["characters/_index.md", "character-registry"],
  ["worldbuilding/_index.md", "world-registry"],
  ["plot/_index.md", "plot-registry"],
  ["plot/timeline.md", "timeline"],
  ["chapters/_index.md", "chapter-registry"],
  ["scenes/_index.md", "scene-registry"],
  ["continuity/questions/_index.md", "question-registry"],
  ["continuity/promises/_index.md", "promise-registry"],
  ["continuity/clues/_index.md", "clue-registry"],
  ["glossary/_index.md", "glossary-registry"]
];

export const STORY_STATUSES = new Set(["planning", "drafting", "in-progress", "revising", "complete", "abandoned"]);

export const STORY_TENSES = new Set(["past", "present", "future", "mixed"]);

export const CHARACTER_ROLES = new Set(["protagonist", "antagonist", "supporting", "minor", "narrator", "deuteragonist"]);

export const CHARACTER_STATUSES = new Set(["alive", "deceased", "unknown", "missing", "cut"]);

export const ARC_TYPES = new Set(["main", "subplot", "character", "thematic"]);

export const ARC_STATUSES = new Set(["planned", "in-progress", "resolved"]);

export const CHAPTER_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);

// A character's arc shape (theme-craft): which way the lie and truth move.
export const CHARACTER_ARC_TYPES = new Set(["change-positive", "change-negative", "flat"]);

// Chapter `mode` and story.md `draft-mode`: how the prose was written.
export const DRAFT_MODES = new Set(["discovered", "outlined"]);

export const SCENE_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);

export const FACTION_TYPES = new Set(["family", "guild", "government", "military", "religion", "company", "community", "criminal", "other"]);

export const FACTION_STATUSES = new Set(["active", "hidden", "declining", "defeated", "disbanded", "unknown"]);

export const ARTIFACT_TYPES = new Set(["object", "weapon", "document", "technology", "relic", "symbol", "resource", "other"]);

export const ARTIFACT_STATUSES = new Set(["active", "lost", "destroyed", "hidden", "transferred", "unknown"]);

export const QUESTION_STATUSES = new Set(["open", "answered", "resolved", "dropped", "abandoned"]);

export const PROMISE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped", "abandoned"]);

export const CLUE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped", "abandoned"]);

// Whether a promise, clue, or question chapter field (`planted`, `payoff`,
// `introduced`, `resolved`) may name a scheduled chapter-NN with no file yet:
// only a status that says the chapter is on the page needs it written. A
// thread can be abandoned before its setup reaches the page, so an abandoned
// one schedules like a planned promise or clue or an open question; continuity
// skips it. An open question never records `resolved`, so one abandoned
// before its answer has none, and `resolved` must always be written. links
// and add share this rule.
export function mayScheduleChapter(kind, field, status) {
  const setupPending = status === "abandoned" || status === (kind === "question" ? "open" : "planned");
  if (field === "payoff") {
    return status !== "paid-off";
  }
  return field !== "resolved" && setupPending;
}

export const TERM_CATEGORIES = new Set(["person", "place", "faction", "artifact", "concept", "term", "other"]);

export const STYLE_DIALECTS = new Set(["british", "american", "unspecified"]);

export const STYLE_SHEET_FILE = "style-sheet.md";

export const MATTER_PLACEMENTS = new Set(["front", "back"]);

export const MATTER_PERMISSIONS = new Set(["not-needed", "pending", "granted", "public-domain"]);

export const MATTER_DIR = "matter";

export const RESEARCH_STATUSES = new Set(["open", "verified", "disputed"]);

export const RESEARCH_ACCURACY = new Set(["must-be-accurate", "blended", "invented"]);

export const RESEARCH_CONFIDENCE = new Set(["high", "medium", "low"]);

export const RESEARCH_METHODS = new Set(["fact", "interview", "site-visit", "expert-review", "reading"]);

export const RESEARCH_RISKS = new Set(["legal", "medical", "weapons", "safety", "cultural", "defamation", "technical"]);

export const RESEARCH_DIR = "research";

// Chapter statuses that mean the prose is settled, so it should not rest on
// research that is still open or disputed.
export const SETTLED_CHAPTER_STATUSES = new Set(["final", "complete"]);

export const WRITTEN_CHAPTER_STATUSES = new Set(["revised", "final", "complete"]);

// A schema-version above the one this CLI writes belongs to a newer
// story-skills; returns it as a number, or null.
export function newerSchemaVersion(value) {
  const version = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof version === "number" && Number.isFinite(version) && version > STORY_SCHEMA_VERSION ? version : null;
}

export function newerSchemaMessage(version) {
  return `story.md uses schema-version ${version}, newer than this CLI (${STORY_SCHEMA_VERSION}); upgrade story-skills`;
}

export function entityConfig(kind) {
  const configs = {
    character: { dir: "characters", titleField: "name" },
    location: { dir: "worldbuilding/locations", titleField: "name" },
    system: { dir: "worldbuilding/systems", titleField: "name" },
    faction: { dir: "worldbuilding/factions", titleField: "name" },
    artifact: { dir: "worldbuilding/artifacts", titleField: "name" },
    arc: { dir: "plot/arcs", titleField: "name" },
    chapter: { dir: "chapters", titleField: "title" },
    scene: { dir: "scenes", titleField: "title" },
    question: { dir: "continuity/questions", titleField: "title" },
    promise: { dir: "continuity/promises", titleField: "title" },
    clue: { dir: "continuity/clues", titleField: "title" },
    term: { dir: "glossary/terms", titleField: "term" },
    matter: { dir: MATTER_DIR, titleField: "title" },
    research: { dir: RESEARCH_DIR, titleField: "title" }
  };
  // normalizeKind has already rejected unknown kinds.
  return configs[kind];
}

// The frontmatter reference fields that can name more than one kind, with
// the kinds each names. An id two of those kinds share leaves such a
// reference ambiguous: add refuses the id, validate warns about one made by
// hand, and rename and remove leave the reference alone and say so.
export const MULTI_KIND_REFERENCE_FIELDS = {
  "controlled-by": ["faction", "character"],
  mentions: ["character", "artifact"],
  owner: ["character", "faction"]
};

export const KIND_ALIASES = {
  character: 'character',
  characters: 'character',
  location: 'location',
  locations: 'location',
  system: 'system',
  systems: 'system',
  faction: 'faction',
  factions: 'faction',
  artifact: 'artifact',
  artifacts: 'artifact',
  arc: 'arc',
  arcs: 'arc',
  chapter: 'chapter',
  chapters: 'chapter',
  scene: 'scene',
  scenes: 'scene',
  question: 'question',
  questions: 'question',
  promise: 'promise',
  promises: 'promise',
  clue: 'clue',
  clues: 'clue',
  term: 'term',
  terms: 'term',
  'glossary-term': 'term',
  'glossary-terms': 'term',
  glossary: 'term',
  matter: 'matter',
  research: 'research',
  'research-note': 'research',
  'research-notes': 'research'
};

export function normalizeKind(kind) {
  const normalized = String(kind ?? '').trim().toLowerCase();
  const expected = [...new Set(Object.values(KIND_ALIASES))].join(', ');
  if (normalized === '') {
    throw usageError(`An entity kind is required: expected one of ${expected}`);
  }
  if (!Object.hasOwn(KIND_ALIASES, normalized)) {
    throw usageError(`Unsupported entity kind: ${kind}: expected one of ${expected}`);
  }
  return KIND_ALIASES[normalized];
}

export const REGISTRY_HINT = " (it is a registry: run story reindex to rebuild it)";

export const ENTITY_SCAN_DIRS = [
  "characters",
  "chapters",
  "scenes",
  "worldbuilding/locations",
  "worldbuilding/systems",
  "worldbuilding/factions",
  "worldbuilding/artifacts",
  "plot/arcs",
  "continuity/questions",
  "continuity/promises",
  "continuity/clues",
  "glossary/terms",
  MATTER_DIR,
  RESEARCH_DIR
];

// Paths that hold project source. Generated output must never land there:
// an --out pointing at a chapter would silently replace the prose.
export const SOURCE_ROOT_FILES = new Set(["story.md", STYLE_SHEET_FILE, PROGRESS_FILE]);

export const SOURCE_DIRECTORIES = ["characters", "chapters", "scenes", "worldbuilding", "plot", "continuity", "glossary", MATTER_DIR, RESEARCH_DIR];

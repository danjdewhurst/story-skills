// Commands that write the project: init, add, rename, remove, move, split,
// merge, reindex, wordcount, and migrate.
// They do not take the project lock themselves: runCli holds it around every
// command whose registry entry declares `writes` (see commands.js), and
// createStoryProject locks the folders init and import fill. A caller
// outside the CLI wraps them in withProjectLock.
//
// The commands live in the mutate-*.js modules; this file re-exports their
// public names, so callers keep importing from mutate.js.

export { REFERENCE_FIELD_KINDS, NESTED_TO_KINDS, resolveLinkTarget } from "./mutate-references.js";
export {
  reindexProject,
  computeWordCounts,
  migrateProject,
  fixProject
} from "./mutate-maintenance.js";
export { newProjectRoot, createStoryProject } from "./mutate-init.js";
export { createEntity } from "./mutate-add.js";
export { renameEntity, removeEntity } from "./mutate-rename.js";
export { moveEntity } from "./mutate-move.js";
export { restructureWrites } from "./mutate-restructure.js";
export { splitChapter } from "./mutate-split.js";
export { mergeChapters } from "./mutate-merge.js";

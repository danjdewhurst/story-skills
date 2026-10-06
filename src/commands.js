import fs from "node:fs";
import path from "node:path";
import { formatClueMatrix } from "./clues.js";
import { formatKnowledgeMark } from "./chronology.js";
import { formatContext } from "./context.js";
import { formatGrid, gridFormat } from "./grid.js";
import { formatList } from "./list.js";
import { formatComparison, formatLabelMapping } from "./compare.js";
import { applySeverity } from "./config.js";
import { FINDING_CODES, warn } from "./findings.js";
import { importManuscript } from "./import.js";
import { currentText, planChanges, recordChanges } from "./files.js";
import { diagnosticsFrom, resultData, wantsJson, writeJsonResult } from "./json.js";
import { previewChanges, previewNewProject } from "./preview.js";
import { workflowPinActions } from "./workflows.js";
import { isTruthy, optionValues } from "./options.js";
import { STDIN_ARG, readStdin, stdinText } from "./stdin.js";
import { formatMentions } from "./mentions.js";
import { formatNames } from "./names.js";
import { formatPacing } from "./pacing.js";
import { DEFAULT_PASSES, formatPasses, nextPass, passChecks } from "./passes.js";
import { formatProgress } from "./progress.js";
import { formatStateChanges } from "./progressions.js";
import { formatProseReport } from "./prose.js";
import { formatSeriesReport } from "./series.js";
import { formatSimilarity } from "./similarity.js";
import { SNAPSHOTS_DIR, SNAPSHOT_MANIFEST, existingSnapshot, formatRestore, formatRestorePreview, formatSnapshot, formatSnapshotList, listSnapshots, restoreSnapshot, restoreSources, snapshotId, snapshotProject } from "./snapshots.js";
import { formatTimeline } from "./timeline.js";
import { formatVoices } from "./voices.js";
import {
  buildBook,
  checkProjectContinuity,
  clueReport,
  compareProject,
  computeWordCounts,
  createEntity,
  createStoryProject,
  diagramProject,
  entityStateAtChapter,
  gridReport,
  listReport,
  draftingContext,
  exportManuscript,
  formatActionReport,
  formatDoctorReport,
  formatProjectReport,
  fixProject,
  knowledgeAtChapter,
  mentionsReport,
  mergeChapters,
  migrateProject,
  moveEntity,
  namesReport,
  newProjectRoot,
  pacingReport,
  projectCheck,
  projectPasses,
  projectActions,
  projectProgress,
  projectReport,
  proseReport,
  reindexProject,
  removeEntity,
  shellWord,
  renameEntity,
  scanProject,
  seriesReport,
  similarityReport,
  splitChapter,
  storyTimeline,
  synopsisBook,
  uniqueCheckFindings,
  validateLinks,
  validateProject,
  voicesReport
} from "./story.js";
import { EXIT_CODES, usageError } from "./exit-codes.js";

// How --json names a piped passage in a diagnostic, as the text output does.
const STDIN_LABEL = "stdin";

// The options each kind of `story add` reads; every kind also takes
// --dry-run and --json, and an option only other kinds read is an error. A
// chapter or scene takes no --id, as its id comes from its number.
const ADD_KIND_OPTIONS = {
  character: ["id", "role", "status", "location", "locations", "arc"],
  location: ["id", "type", "status", "region", "population", "controlled-by", "character", "characters"],
  system: ["id", "type", "prevalence"],
  faction: ["id", "type", "status", "member", "members", "character", "characters", "location", "locations"],
  artifact: ["id", "type", "status", "owner", "location"],
  arc: ["id", "type", "status", "character", "characters", "theme", "themes", "acts", "act"],
  chapter: ["number", "pov", "location", "locations", "character", "characters", "mention", "mentions", "arc", "arcs", "status", "mode", "date", "time", "hook"],
  scene: [
    "chapter", "scene", "pov", "location", "character", "characters", "mention", "mentions", "arc", "arcs", "status", "date", "time",
    "travel-hours", "sequel", "outcome", "dilemma"
  ],
  question: ["id", "status", "introduced", "resolved", "character", "characters"],
  promise: ["id", "status", "planted", "payoff", "arc", "arcs", "character", "characters"],
  clue: ["id", "status", "planted", "payoff", "significance-delayed", "red-herring", "character", "characters", "arc", "arcs"],
  term: ["id", "category", "alias", "aliases"],
  matter: ["id", "placement", "order", "heading"],
  research: ["id", "status", "source", "sources", "used-in", "accuracy", "confidence", "method", "risk"]
};

// The flags of every command that writes the project in place: --dry-run
// previews the changes and --json reports them (see runWrite).
const WRITE_OPTIONS = ["dry-run", "json"];

// Every CLI command, in help order. `project` says how the command finds its
// story project: "positional" takes an optional path as its first argument
// (or --path), "flag" takes only --path, and "none" means the command makes a
// new project and refuses --path. `args` caps the positional arguments after
// the command name (default: 1 for "positional", 0 otherwise) and `options`
// lists the flags the command reads besides --path, so a stray argument or
// flag is an error rather than silently ignored. `kinds`, for a command whose
// first argument is an entity kind, maps each kind to the flags it reads, so
// a flag meant for another kind is an error too. `run` receives
// { parsed, io, cwd, root, overrides, defaulted }, where root() resolves
// the project path and overrides holds the story.md severity overrides and
// the exemptions that name a code (see findingOverrides), passed to
// applySeverity, and returns the exit code. story.md cli-defaults are
// already merged into parsed.options; `defaulted` names the flags they
// filled in.
export const COMMANDS = [
  {
    name: "init",
    usage: "init <title>",
    summary: ["Scaffold a story project"],
    project: "none",
    args: Infinity,
    options: ["dir", "genre", "sub-genre", "setting-era", "theme", "themes", "pov", "tense", "form", "synopsis", "series", "book-number", "follows", "precedes", "force", "dry-run"],
    run({ parsed, io, cwd }) {
      const dryRun = isTruthy(parsed.options["dry-run"]);
      const title = parsed.positionals.slice(1).join(" ");
      // The changes are listed relative to the new project's folder. init
      // writes nothing it reads back, so a --dry-run plans the writes
      // without making them (planChanges).
      const base = newProjectRoot({ title, cwd, dir: parsed.options.dir }) ?? cwd;
      const { result, changes } = runOrPlan(dryRun, base, () => createStoryProject({
        title,
        cwd,
        dir: parsed.options.dir,
        genre: parsed.options.genre,
        subGenre: parsed.options["sub-genre"],
        settingEra: parsed.options["setting-era"],
        themes: collectThemes(parsed.options),
        pov: parsed.options.pov,
        tense: parsed.options.tense,
        form: parsed.options.form,
        synopsis: parsed.options.synopsis,
        series: parsed.options.series,
        bookNumber: parsed.options["book-number"],
        follows: parsed.options.follows,
        precedes: parsed.options.precedes,
        force: isTruthy(parsed.options.force)
      }));
      if (dryRun) {
        io.stdout.write(formatPreview("init", changes));
      } else {
        io.stdout.write(`${result.keptStory ? "Updated" : "Created"} story project: ${result.root}\n`);
      }
      reportKeptStory(io, result, "the title");
      reportGitignore(io, result);
      if (dryRun) {
        return 0;
      }
      for (const linkedBook of result.linkedBooks) {
        io.stdout.write(`Updated series links in ${path.join(linkedBook, "story.md")}\n`);
      }
      return 0;
    }
  },
  {
    name: "import",
    usage: "import <source|->",
    summary: ["Split an existing manuscript into a new story project;", "- reads the manuscript from stdin"],
    project: "none",
    args: 1,
    options: ["title", "dir", "genre", "sub-genre", "setting-era", "theme", "themes", "pov", "tense", "synopsis", "language", "force", "dry-run"],
    run({ parsed, io, cwd }) {
      const dryRun = isTruthy(parsed.options["dry-run"]);
      const options = {
        source: parsed.positionals[1],
        readStdin: () => pipedText(io, "import"),
        title: parsed.options.title,
        cwd,
        dir: parsed.options.dir,
        genre: parsed.options.genre,
        subGenre: parsed.options["sub-genre"],
        settingEra: parsed.options["setting-era"],
        themes: collectThemes(parsed.options),
        pov: parsed.options.pov,
        tense: parsed.options.tense,
        synopsis: parsed.options.synopsis,
        language: parsed.options.language,
        force: isTruthy(parsed.options.force)
      };
      if (dryRun) {
        return previewImport(io, options);
      }
      const result = importManuscript(options);
      const [length, noun] = result.characters === undefined ? [result.words, "word"] : [result.characters, "character"];
      io.stdout.write(`Imported ${result.chapters} ${result.chapters === 1 ? "chapter" : "chapters"} (${length} ${length === 1 ? noun : `${noun}s`}) into ${result.root}\n`);
      reportImportNotes(io, result);
      if (result.candidates.length > 0) {
        io.stdout.write("Entity candidates (review, then create with story add):\n");
        for (const candidate of result.candidates) {
          io.stdout.write(`- ${candidate.name} (${candidate.count} mentions)\n`);
        }
      }
      return 0;
    }
  },
  {
    name: "validate",
    usage: "validate [path]",
    summary: ["Check project structure, frontmatter, and registries"],
    project: "positional",
    options: ["json"],
    run: ({ parsed, io, root, overrides }) => reportCheck(parsed, io, "validate", applySeverity(validateProject(root()), overrides), "Project is valid", "Project validation failed")
  },
  {
    name: "reindex",
    usage: "reindex [path]",
    summary: ["Rebuild registry tables from markdown files"],
    project: "positional",
    options: WRITE_OPTIONS,
    run: (context) => runWrite(context, "reindex", reindexProject, (result) => (result.changed.length === 0
      ? "Registries already up to date\n"
      : `Updated ${result.changed.length} registries\n`))
  },
  {
    name: "wordcount",
    usage: "wordcount [path]",
    summary: ["Count chapter prose words"],
    project: "positional",
    options: ["write", ...WRITE_OPTIONS],
    run(context) {
      const write = isTruthy(context.parsed.options.write);
      if (!write && isTruthy(context.parsed.options["dry-run"])) {
        throw usageError("--dry-run previews wordcount --write: add --write");
      }
      return runWrite(context, "wordcount", (projectRoot) => computeWordCounts(projectRoot, { write }), (result) => {
        // A project counted in characters prints characters, and says so.
        const characters = result.unit === "characters";
        return result.chapters.map((chapter) => `${chapter.file}: ${characters ? chapter.characterCount : chapter.wordCount}\n`).join("")
          + `Total: ${result.total}${characters ? " characters" : ""}\n`;
      });
    }
  },
  {
    name: "links",
    usage: "links [path]",
    summary: ["Check cross-reference targets and backlinks"],
    project: "positional",
    options: ["json"],
    run: ({ parsed, io, root, overrides }) => reportCheck(parsed, io, "links", applySeverity(validateLinks(root()), overrides), "Links are valid", "Link check failed")
  },
  {
    name: "continuity",
    usage: "continuity [path]",
    summary: [
      "Check deterministic continuity contracts: deaths,",
      "casts and cut characters, promises, questions,",
      "clues, prop custody, clock and travel time,",
      "location routes, and durable state.",
      "Findings matching continuity/exemptions.md are",
      "reported as dismissed"
    ],
    project: "positional",
    options: ["json"],
    run: ({ parsed, io, root, overrides }) => reportCheck(parsed, io, "continuity", applySeverity(checkProjectContinuity(root()), overrides), "Continuity is consistent", "Continuity check failed")
  },
  {
    name: "check",
    usage: "check [path]",
    summary: [
      "Run validate, links, and continuity over one scan",
      "and report each finding once; --strict fails on",
      "warnings too"
    ],
    project: "positional",
    options: ["strict", "json"],
    run({ parsed, io, root, overrides }) {
      const result = projectCheck(root(), { overrides, strict: isTruthy(parsed.options.strict) });
      if (wantsJson(parsed)) {
        return writeJsonResult(io, {
          command: "check",
          ok: result.ok,
          data: { ...checkCounts(result), strict: result.strict, checks: checkSummaries(result.checks) },
          diagnostics: Object.entries(result.findings).flatMap(([name, check]) => diagnosticsFrom(check, name))
        });
      }
      return reportResult(io, result, "Checks passed", "Checks failed");
    }
  },
  {
    name: "knowledge",
    usage: "knowledge <id>",
    summary: [
      "List what a character knew at a chapter, marked",
      "reader-knowledge or character-knowledge, and the",
      "changes its progressions made by then; requires --at"
    ],
    project: "flag",
    args: 1,
    options: ["at", "json"],
    run({ parsed, io, root }) {
      const characterId = parsed.positionals[1];
      const atChapterId = parsed.options.at;
      if (!characterId || typeof atChapterId !== "string") {
        // Thrown, so runCli reports it as text or, with --json, as a result.
        throw usageError("Usage: story knowledge <character-id> --at <chapter-id> [--path <project>]");
      }
      const projectRoot = root();
      // One scan serves both lookups.
      const project = scanProject(projectRoot);
      const entries = knowledgeAtChapter(projectRoot, characterId, atChapterId, project);
      const { state, changes } = entityStateAtChapter(projectRoot, "character", characterId, atChapterId, project);
      if (wantsJson(parsed)) {
        return writeJsonResult(io, { command: "knowledge", ok: true, data: { character: characterId, at: atChapterId, entries, state, changes } });
      }
      if (entries.length === 0) {
        io.stdout.write(`No recorded knowledge for ${characterId} at ${atChapterId}\n`);
      }
      for (const entry of entries) {
        io.stdout.write(`- ${entry.knows} (${formatKnowledgeMark(entry.learnedIn, entry.audience)})\n`);
      }
      io.stdout.write(formatStateChanges(changes, atChapterId));
      return 0;
    }
  },
  {
    name: "context",
    usage: "context <id>",
    summary: [
      "Pack drafting context for a chapter or scene within",
      "a token budget. An unread flashback fact is marked",
      "character-knowledge; do not reveal it"
    ],
    project: "flag",
    args: 1,
    options: ["budget", "scenes", "json"],
    run({ parsed, io, root, overrides }) {
      const targetId = parsed.positionals[1];
      if (!targetId) {
        // Thrown, so runCli reports it as text or, with --json, as a result.
        throw usageError("Usage: story context <chapter-or-scene-id> [--budget <tokens>] [--scenes <n>] [--path <project>]");
      }
      const context = draftingContext(root(), targetId, { budget: parsed.options.budget, scenes: parsed.options.scenes });
      const checked = checkedWarnings(context.warnings, overrides);
      if (wantsJson(parsed)) {
        // data.warnings stays the plain text the result schema describes,
        // and leaves out a warning story.md severity turned off.
        const skipped = [...checked.errors, ...checked.warnings].map((finding) => finding.message);
        return writeJsonResult(io, { command: "context", ok: checked.ok, data: { ...context, warnings: skipped }, diagnostics: diagnosticsFrom(checked, "context") });
      }
      io.stdout.write(formatContext(context));
      return writeFindings(io, checked);
    }
  },
  {
    name: "compare",
    usage: "compare [path]",
    summary: [
      "Compare chapters with an earlier draft: word changes,",
      "added and removed chapters, and unchanged paragraphs;",
      "requires --ref, --against, or --snapshot; --anchor",
      "maps old review-copy labels to the current",
      "paragraphs"
    ],
    project: "positional",
    options: ["ref", "against", "snapshot", "anchor", "json"],
    run({ parsed, io, cwd, root, overrides }) {
      const comparison = applySeverity(compareProject(root(), {
        ref: parsed.options.ref,
        against: parsed.options.against,
        snapshot: parsed.options.snapshot,
        anchors: parsed.options.anchor,
        cwd
      }), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "compare", compareData(comparison));
      }
      io.stdout.write(comparison.anchors ? formatLabelMapping(comparison.anchors, comparison.label) : formatComparison(comparison, comparison.label));
      return reportResult(io, comparison, "Comparison complete", "Comparison failed");
    }
  },
  {
    name: "similarity",
    usage: "similarity [path]",
    summary: [
      "Find passages of chapter prose that share a run of",
      "words with other text (--against a file, folder, or",
      "git ref, or --snapshot a saved snapshot); advisory,",
      "never proof of copying"
    ],
    project: "positional",
    options: ["against", "snapshot", "min-words", "json"],
    run({ parsed, io, cwd, root, overrides, defaulted }) {
      const report = applySeverity(similarityReport(root(), { ...parsed.options, cwd, againstFromProject: defaulted.has("against") }), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "similarity", report);
      }
      io.stdout.write(formatSimilarity(report));
      return reportResult(io, report, "Similarity check complete", "Similarity check failed");
    }
  },
  {
    name: "progress",
    usage: "progress [path]",
    summary: [
      "Show words against target-words, deadline, chapter",
      "targets, logged sessions, the daily target, the",
      "writing streak, and weekly totals (--weeks);",
      "--log records today"
    ],
    project: "positional",
    options: ["log", "date", "weeks", ...WRITE_OPTIONS],
    run({ parsed, io, root, overrides }) {
      const log = isTruthy(parsed.options.log);
      const dryRun = isTruthy(parsed.options["dry-run"]);
      if (!log && dryRun) {
        throw usageError("--dry-run previews progress --log: add --log");
      }
      const projectRoot = root();
      const { result, changes } = runOrPreview(dryRun, projectRoot, (target) => projectProgress(target, { log, date: parsed.options.date, weeks: parsed.options.weeks }));
      const progress = applySeverity(result, overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "progress", { ...progress, dryRun, changes }, { writes: dryRun ? [] : writtenFiles(projectRoot, changes) });
      }
      if (dryRun) {
        io.stdout.write(formatPreview("progress", changes));
      } else if (progress.logged) {
        const { characterCount, words } = progress.logged;
        io.stdout.write(`Logged ${characterCount === null ? `${words} words` : `${characterCount} characters`} for ${progress.logged.date} in ${progress.logged.file}\n`);
      }
      io.stdout.write(formatProgress(progress));
      return reportResult(io, progress, "Progress checked", "Progress check failed");
    }
  },
  {
    name: "timeline",
    usage: "timeline [path]",
    summary: [
      "Show scenes in story-time order (marking scenes told",
      "out of order), POV balance, and character presence"
    ],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const timeline = applySeverity(storyTimeline(root()), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "timeline", timeline);
      }
      io.stdout.write(formatTimeline(timeline, timeline.totalChapters));
      return reportResult(io, timeline, "Timeline built", "Timeline failed");
    }
  },
  {
    name: "prose",
    usage: "prose [path|-]",
    summary: [
      "Lint chapter prose: filter words, adverbs, dialogue",
      "tags, echoes, rhythm, repeated phrases, similar",
      "names, and style-sheet.md spellings and watch words;",
      "- lints a passage from stdin"
    ],
    project: "positional",
    options: ["json", "max-filter-words", "max-adverbs", "max-bookisms", "baseline"],
    run({ parsed, io, cwd, root, overrides }) {
      const report = applySeverity(parsed.positionals[1] === STDIN_ARG
        ? proseReport(passageRoot(parsed, cwd, false), { ...parsed.options, passage: pipedText(io, "prose") })
        : proseReport(root(), parsed.options), overrides);
      if (wantsJson(parsed)) {
        // Each chapter's tokenized sentences feed the repeated-phrase check;
        // they are the whole chapter again, so --json leaves them out.
        const chapters = report.chapters.map(({ analysis: { phraseSentences, ...analysis }, ...chapter }) => ({ ...chapter, analysis }));
        return reportJson(io, "prose", { ...report, chapters }, { passage: parsed.positionals[1] === STDIN_ARG });
      }
      io.stdout.write(formatProseReport(report));
      return reportResult(io, report, "Prose check complete", "Prose check failed");
    }
  },
  {
    name: "diagram",
    usage: "diagram <kind>",
    summary: [
      "Print Mermaid source for relationships (family",
      "tree), locations (route map), timeline, clues, or",
      "arcs; --out writes it to a file"
    ],
    project: "flag",
    args: 1,
    options: ["out", ...WRITE_OPTIONS],
    run({ parsed, io, root }) {
      const kind = parsed.positionals[1];
      const dryRun = outputDryRun(parsed, "diagram");
      const projectRoot = root();
      const { result, changes } = runOrPlan(dryRun, projectRoot, () => diagramProject(projectRoot, { kind, out: parsed.options.out }));
      if (wantsJson(parsed)) {
        const outFile = result.outFile ?? null;
        return reportJson(io, "diagram", { ...result, kind, outFile, dryRun, changes }, { writes: dryRun ? [] : writtenFiles(projectRoot, changes) });
      }
      if (result.ok) {
        io.stdout.write(dryRun ? formatPreview("diagram", changes)
          : result.outFile === undefined ? result.text : `Wrote ${parsed.positionals[1]} diagram to ${result.outFile}\n`);
        return 0;
      }
      return reportResult(io, result, "Diagram built", "Diagram failed");
    }
  },
  {
    name: "names",
    usage: "names <name...>",
    summary: [
      "Check candidate names against characters, places,",
      "factions, artifacts, systems, and glossary terms:",
      "clashes are errors, look-alikes are warnings"
    ],
    project: "flag",
    args: Infinity,
    options: ["json"],
    run({ parsed, io, cwd, root, overrides }) {
      const report = applySeverity(namesReport(root(), nameWords(parsed, 1, cwd, "names")), overrides);
      if (wantsJson(parsed)) {
        const { results, ...rest } = report;
        return reportJson(io, "names", { ...rest, names: results });
      }
      io.stdout.write(formatNames(report));
      return reportResult(io, report, "Names checked", "Name check failed");
    }
  },
  {
    name: "mentions",
    usage: "mentions [<kind> <id>]",
    summary: [
      "List each place chapter prose names an entity, by",
      "name, given name, or alias; with no entity, warn",
      "about names a chapter does not list and mentions",
      "it never names"
    ],
    project: "flag",
    args: 2,
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const report = applySeverity(mentionsReport(root(), { kind: parsed.positionals[1], id: parsed.positionals[2] }), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "mentions", report);
      }
      if (report.mode === "entity") {
        io.stdout.write(formatMentions(report));
      }
      return reportResult(io, report, "Mentions checked", "Mention check failed");
    }
  },
  {
    name: "pacing",
    usage: "pacing [path]",
    summary: [
      "Show words, scenes, sequels, scene outcomes, and",
      "chapter hooks per chapter; flag easy-win runs,",
      "missing sequels, and length outliers"
    ],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const report = applySeverity(pacingReport(root()), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "pacing", report);
      }
      io.stdout.write(formatPacing(report));
      return reportResult(io, report, "Pacing check complete", "Pacing check failed");
    }
  },
  {
    name: "clues",
    usage: "clues [path]",
    summary: [
      "Show the clue plant/reveal grid by chapter and flag",
      "fair-play problems: late plants, unplanted reveals,",
      "and red herrings never debunked"
    ],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const report = applySeverity(clueReport(root()), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "clues", report);
      }
      io.stdout.write(formatClueMatrix(report));
      return reportResult(io, report, "Clue check complete", "Clue check failed");
    }
  },
  {
    name: "grid",
    usage: "grid [path]",
    summary: [
      "Print the plot grid: arcs by chapter from",
      "arcs-advanced, with each chapter's hook and scene",
      "outcomes, as a markdown table or --format csv"
    ],
    project: "positional",
    options: ["format", "from", "to", "json"],
    run({ parsed, io, root }) {
      const format = gridFormat(parsed.options.format);
      const report = gridReport(root(), { from: parsed.options.from, to: parsed.options.to });
      if (wantsJson(parsed)) {
        return reportJson(io, "grid", report);
      }
      // A grid drawn from a partly unreadable project would silently drop
      // chapters, so, as with diagram, nothing is printed until the scan is
      // clean.
      if (report.ok) {
        io.stdout.write(formatGrid(report, format));
        return 0;
      }
      return reportResult(io, report, "Grid built", "Grid failed");
    }
  },
  {
    name: "list",
    usage: "list <kind>",
    summary: [
      "List the chapters, scenes, characters, or other",
      "entities whose frontmatter matches every --where",
      "filter, in book order"
    ],
    project: "flag",
    args: 1,
    options: ["where", "json"],
    run({ parsed, io, root }) {
      const report = listReport(root(), parsed.positionals[1], parsed.options.where);
      if (wantsJson(parsed)) {
        return reportJson(io, "list", report);
      }
      // As with grid, a partly unreadable project would silently drop the
      // files that fail to parse, so nothing is listed until the scan is
      // clean.
      if (report.ok) {
        io.stdout.write(formatList(report));
        io.stderr.write(`${report.items.length} of ${report.total} ${report.kind} matched\n`);
        return 0;
      }
      return reportResult(io, report, "Listed", "List failed");
    }
  },
  {
    name: "voices",
    usage: "voices [path|-]",
    summary: [
      "Fingerprint each character's tagged dialogue and flag",
      "voice-avoid words, unused voice-words, and",
      "characters who sound alike; - checks a passage",
      "from stdin"
    ],
    project: "positional",
    options: ["json"],
    run({ parsed, io, cwd, root, overrides }) {
      const report = applySeverity(parsed.positionals[1] === STDIN_ARG
        ? voicesReport(passageRoot(parsed, cwd, true), { passage: pipedText(io, "voices") })
        : voicesReport(root()), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "voices", report, { passage: parsed.positionals[1] === STDIN_ARG });
      }
      io.stdout.write(formatVoices(report));
      return reportResult(io, report, "Voice check complete", "Voice check failed");
    }
  },
  {
    name: "series",
    usage: "series [path]",
    summary: ["Order linked prequels and sequels and check shared", "canon across books"],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const report = applySeverity(seriesReport(root()), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "series", report);
      }
      io.stdout.write(formatSeriesReport(report));
      return reportResult(io, report, "Series is consistent", "Series check failed");
    }
  },
  {
    name: "passes",
    usage: "passes [path]",
    summary: [
      "Show the named revision passes in story.md;",
      "--init adds the default ladder, --start and --done",
      "mark a pass"
    ],
    project: "positional",
    options: ["init", "start", "done", ...WRITE_OPTIONS],
    run({ parsed, io, root }) {
      const change = { init: isTruthy(parsed.options.init), start: parsed.options.start, done: parsed.options.done };
      const dryRun = isTruthy(parsed.options["dry-run"]);
      if (dryRun && !change.init && change.start === undefined && change.done === undefined) {
        throw usageError("--dry-run previews passes --init, --start, or --done: add one");
      }
      const projectRoot = root();
      const { result, changes } = runOrPreview(dryRun, projectRoot, (target) => projectPasses(target, change));
      const where = shellWord(displayPath(parsed));
      if (wantsJson(parsed)) {
        return writeJsonResult(io, {
          command: "passes",
          ok: true,
          data: { ...passesData(result, where), dryRun, changes },
          writes: dryRun ? [] : writtenFiles(projectRoot, changes)
        });
      }
      for (const note of result.notes ?? []) {
        io.stderr.write(`note: ${note}\n`);
      }
      if (dryRun) {
        io.stdout.write(formatPreview("passes", changes));
      } else if (result.changed) {
        io.stdout.write("Updated revision-passes in story.md\n");
      }
      io.stdout.write(formatPasses(result.passes, where === "." ? "story passes" : `story passes ${where}`));
      return 0;
    }
  },
  {
    name: "snapshot",
    usage: "snapshot <name>",
    summary: [
      "Save a named copy of the project's markdown in",
      ".snapshots/ to compare with later (compare",
      "--snapshot); --list shows the saved snapshots;",
      "--restore puts one back, saving the project first"
    ],
    project: "flag",
    args: 1,
    options: ["id", "list", "restore", "force", ...WRITE_OPTIONS],
    run(context) {
      const { parsed, io, root } = context;
      const name = parsed.positionals[1];
      if (parsed.options.restore !== undefined) {
        return runRestore(context, name);
      }
      if (isTruthy(parsed.options.list)) {
        for (const flag of ["id", "force", "dry-run"]) {
          if (flag === "id" ? parsed.options.id !== undefined : isTruthy(parsed.options[flag])) {
            throw usageError(`--${flag} does not apply to story snapshot --list`);
          }
        }
        if (name !== undefined) {
          throw usageError("story snapshot --list takes no name: it lists every snapshot");
        }
        const report = listSnapshots(root());
        if (wantsJson(parsed)) {
          return reportJson(io, "snapshot", report);
        }
        io.stdout.write(formatSnapshotList(report));
        return 0;
      }
      if (name === undefined) {
        throw usageError("Usage: story snapshot <name>, or story snapshot --list");
      }
      const force = isTruthy(parsed.options.force);
      const id = parsed.options.id;
      const projectRoot = root();
      // The --dry-run copy leaves out dot-folders, .snapshots/ among them, so
      // the snapshot being replaced is copied in first: the preview then
      // lists what --force would update and delete, and refuses as the real
      // run does when the name is taken.
      const existing = path.join(projectRoot, SNAPSHOTS_DIR, snapshotId(name, id));
      const seed = (target) => {
        if (target !== projectRoot && fs.existsSync(existing)) {
          fs.cpSync(existing, path.join(target, path.relative(projectRoot, existing)), { recursive: true });
        }
      };
      return runWrite(context, "snapshot", (target) => {
        seed(target);
        return snapshotProject(target, { name, id, force });
      }, formatSnapshot);
    }
  },
  {
    name: "report",
    usage: "report [path]",
    summary: ["Summarize project inventory, progress, and checks"],
    project: "positional",
    options: ["actionable", "json"],
    run({ parsed, io, root, overrides }) {
      const report = projectReport(root(), { displayPath: displayPath(parsed), overrides });
      if (wantsJson(parsed)) {
        return reportProjectJson(io, "report", report);
      }
      io.stdout.write(formatProjectReport(report, { actionable: isTruthy(parsed.options.actionable) }));
      return 0;
    }
  },
  {
    name: "next",
    usage: "next [path]",
    summary: ["Recommend the next writing and maintenance actions,", "and the next serial release (--date for today)"],
    project: "positional",
    options: ["date", "json"],
    run({ parsed, io, root, overrides }) {
      const { releaseFindings, ...report } = projectActions(root(), { displayPath: displayPath(parsed), overrides, release: true, date: parsed.options.date });
      if (wantsJson(parsed)) {
        return reportProjectJson(io, "next", report, { diagnostics: diagnosticsFrom(releaseFindings, "next") });
      }
      io.stdout.write(formatActionReport(report));
      return 0;
    }
  },
  {
    name: "doctor",
    usage: "doctor [path]",
    summary: ["Show health checks plus actionable repair steps;", "--fix applies the safe repairs first"],
    project: "positional",
    options: ["fix", ...WRITE_OPTIONS],
    run(context) {
      const { parsed, io, cwd, root, overrides } = context;
      const options = { displayPath: displayPath(parsed), overrides };
      if (isTruthy(parsed.options.fix)) {
        return runDoctorFix(context, options);
      }
      if (isTruthy(parsed.options["dry-run"])) {
        throw usageError("--dry-run previews doctor --fix: add --fix");
      }
      const projectRoot = root();
      const report = withWorkflowPins(projectActions(projectRoot, options), projectRoot, cwd);
      if (wantsJson(parsed)) {
        return reportProjectJson(io, "doctor", report);
      }
      io.stdout.write(formatDoctorReport(report));
      return 0;
    }
  },
  {
    name: "migrate",
    usage: "migrate [path]",
    summary: ["Upgrade a project to the current schema"],
    project: "positional",
    options: WRITE_OPTIONS,
    run: (context) => runWrite(context, "migrate", migrateProject, (result) => (result.changed.length === 0
      ? "Project already uses the current schema\n"
      : `Migrated project to current schema: ${result.changed.length} changes\n`))
  },
  {
    name: "add",
    usage: "add <kind> <name>",
    summary: ["Create an entity file and reindex registries"],
    project: "flag",
    args: Infinity,
    options: [...new Set(Object.values(ADD_KIND_OPTIONS).flat()), ...WRITE_OPTIONS],
    kinds: ADD_KIND_OPTIONS,
    run(context) {
      const { parsed, cwd } = context;
      const options = {
        ...entityOptions(parsed),
        kind: parsed.positionals[1],
        name: nameWords(parsed, 2, cwd, "add").join(" ")
      };
      return runWrite(context, "add", (projectRoot) => createEntity(projectRoot, options),
        (result) => `${result.resumed ? "Finished an interrupted add of" : "Created"} ${result.kind} ${result.id}: ${result.file}\n`);
    }
  },
  {
    name: "rename",
    usage: "rename <kind> <id> <name>",
    summary: ["Rename an entity and update id references"],
    project: "flag",
    args: Infinity,
    options: ["id", "prose", ...WRITE_OPTIONS],
    run(context) {
      const { parsed, cwd } = context;
      const options = {
        ...entityOptions(parsed),
        kind: parsed.positionals[1],
        // The positional names the entity being renamed; --id, when given, is
        // the id it moves to instead of one derived from the new name.
        id: parsed.positionals[2],
        newId: parsed.options.id,
        name: nameWords(parsed, 3, cwd, "rename").join(" "),
        prose: isTruthy(parsed.options.prose)
      };
      return runWrite(context, "rename", (projectRoot) => renameEntity(projectRoot, options),
        (result) => `${result.resumed ? "Finished an interrupted rename of" : "Renamed"} ${result.kind} ${result.oldId} to ${result.id}: ${result.file}\n${formatProseRenames(result)}`,
        formatProseRenames);
    }
  },
  {
    name: "remove",
    usage: "remove <kind> <id>",
    summary: ["Remove an entity and scrub id references"],
    project: "flag",
    args: 2,
    options: WRITE_OPTIONS,
    run(context) {
      const { parsed } = context;
      const options = { ...entityOptions(parsed), kind: parsed.positionals[1], id: parsed.positionals[2] };
      return runWrite(context, "remove", (projectRoot) => removeEntity(projectRoot, options), (result) => (result.alreadyGone
        ? `Removed references to ${result.kind} ${result.id}: its file was already gone\n`
        : `Removed ${result.kind} ${result.id}: ${result.file}\n`));
    }
  },
  {
    name: "move",
    usage: "move <kind> <id>",
    summary: [
      "Renumber a chapter (--number) or move a scene",
      "(--chapter, --scene): renames files and rewrites",
      "references"
    ],
    project: "flag",
    args: 2,
    options: ["number", "chapter", "scene", ...WRITE_OPTIONS],
    run(context) {
      const { parsed } = context;
      const options = {
        kind: parsed.positionals[1],
        id: parsed.positionals[2],
        number: parsed.options.number,
        chapter: parsed.options.chapter,
        scene: parsed.options.scene
      };
      return runWrite(context, "move", (projectRoot) => moveEntity(projectRoot, options),
        (result) => `Moved ${result.kind} ${result.oldId} to ${result.id}: ${result.file}${result.moved > 1 ? ` (with ${result.moved - 1} ${result.moved === 2 ? "scene" : "scenes"})` : ""}\n`);
    }
  },
  {
    name: "split",
    usage: "split <chapter-id>",
    summary: [
      "Split a chapter in two at --at (a scene break",
      "number, a heading, or a line of its text),",
      "renumbering the chapters after it"
    ],
    project: "flag",
    args: 1,
    options: ["at", "title", ...WRITE_OPTIONS],
    run(context) {
      const { parsed } = context;
      const options = { id: parsed.positionals[1], at: parsed.options.at, title: parsed.options.title };
      return runWrite(context, "split", (projectRoot) => splitChapter(projectRoot, options),
        (result) => `Split chapter ${result.id}: the rest is ${result.newId} "${result.title}": ${result.file}${restructureDetails(result)}\n`);
    }
  },
  {
    name: "merge",
    usage: "merge <chapter-id> <next-chapter-id>",
    summary: [
      "Merge the next chapter into a chapter, rewriting",
      "references and renumbering the chapters after it"
    ],
    project: "flag",
    args: 2,
    options: WRITE_OPTIONS,
    run(context) {
      const { parsed } = context;
      const options = { id: parsed.positionals[1], next: parsed.positionals[2] };
      return runWrite(context, "merge", (projectRoot) => mergeChapters(projectRoot, options),
        (result) => `Merged chapter ${result.mergedId} into ${result.id}: ${result.file}${restructureDetails(result)}\n`);
    }
  },
  {
    name: "export",
    usage: "export [path]",
    summary: ["Combine front matter, chapters, and back matter into a", "manuscript markdown file"],
    project: "positional",
    options: ["out", "dry-run"],
    run({ parsed, io, root, overrides }) {
      const dryRun = isTruthy(parsed.options["dry-run"]);
      const projectRoot = root();
      const { result, changes } = runOrPlan(dryRun, projectRoot, () => exportManuscript(projectRoot, { out: parsed.options.out }));
      io.stdout.write(dryRun ? formatPreview("export", changes) : `Exported ${result.chapters} chapters to ${result.outFile}\n`);
      return writeFindings(io, checkedWarnings(result.warnings, overrides));
    }
  },
  {
    name: "build",
    usage: "build [path]",
    summary: [
      "Build a disposable book artifact in dist/: markdown,",
      "epub, docx, shunn, html (review copy with paragraph",
      "anchors), print (paged-media interior; --pdf",
      "renders print or shunn to PDF),",
      "narration (audiobook script), metadata (retailer",
      "sheet), fountain (screenplay scene skeleton),",
      "twee (Twine story from chapter choices), ink",
      "(ink story from chapter choices), or codex (story",
      "bible as linked HTML pages in dist/codex/)"
    ],
    project: "positional",
    options: ["out", "format", "shunn", "trim", "paper", "stamp", "note-url", "pdf", "pdf-engine", "spoilers", "dry-run"],
    run({ parsed, io, cwd, root, overrides, defaulted }) {
      const pdf = isTruthy(parsed.options.pdf);
      const dryRun = isTruthy(parsed.options["dry-run"]);
      const projectRoot = root();
      // A build only writes its output, so a --dry-run plans the writes
      // without making them, and finds the PDF engine without running it.
      const { result, changes } = runOrPlan(dryRun, projectRoot, () => buildBook(projectRoot, {
        out: parsed.options.out,
        format: parsed.options.format,
        shunn: isTruthy(parsed.options.shunn),
        trim: parsed.options.trim,
        paper: parsed.options.paper,
        paperDefaulted: defaulted.has("paper"),
        stamp: parsed.options.stamp,
        noteUrl: parsed.options["note-url"],
        pdf,
        // A story.md default engine waits for a build that asks for a PDF.
        pdfEngine: pdf || !defaulted.has("pdf-engine") ? parsed.options["pdf-engine"] : undefined,
        cwd,
        spoilers: isTruthy(parsed.options.spoilers)
      }));
      if (dryRun) {
        io.stdout.write(`${result.pdf ? `PDF engine: ${result.engine} (not run)\n` : ""}${formatPreview("build", changes)}`);
        return writeFindings(io, checkedWarnings(result.warnings, overrides));
      }
      const as = result.pdf ? `${result.format} PDF (${result.engine})` : result.format;
      io.stdout.write(result.format === "codex"
        ? `Built a codex of ${result.pages} pages to ${result.outFile}\n`
        : `Built ${result.chapters} chapters as ${as} to ${result.outFile}\n`);
      return writeFindings(io, checkedWarnings(result.warnings, overrides));
    }
  },
  {
    name: "synopsis",
    usage: "synopsis [path]",
    summary: ["Build a deterministic 1- or 3-page synopsis from arcs"],
    project: "positional",
    options: ["pages", "out", ...WRITE_OPTIONS],
    run({ parsed, io, root }) {
      const dryRun = outputDryRun(parsed, "synopsis");
      const projectRoot = root();
      const { result, changes } = runOrPlan(dryRun, projectRoot, () => synopsisBook(projectRoot, { pages: parsed.options.pages, out: parsed.options.out }));
      if (wantsJson(parsed)) {
        const outFile = result.outFile ?? null;
        return writeJsonResult(io, { command: "synopsis", ok: true, data: { ...result, outFile, dryRun, changes }, writes: dryRun ? [] : writtenFiles(projectRoot, changes) });
      }
      if (dryRun) {
        io.stdout.write(formatPreview("synopsis", changes));
      } else if (result.outFile === undefined) {
        io.stdout.write(result.text);
      } else {
        io.stdout.write(`Wrote synopsis to ${result.outFile}\n`);
      }
      return 0;
    }
  }
];

// The words of a name. Other commands take [path], so a trailing `.` (or
// another project folder) is refused with a hint rather than written into
// the name.
function nameWords(parsed, from, cwd, command) {
  const words = parsed.positionals.slice(from);
  for (const word of words) {
    if (word === "." || word === ".." || (/[\\/]/.test(word) && fs.existsSync(path.join(path.resolve(cwd, word), "story.md")))) {
      throw usageError(`"${word}" looks like a project path: story ${command} takes the project as --path ${word}`);
    }
  }
  return words;
}

// The scenes a split or merge moved and the chapters it renumbered.
function restructureDetails(result) {
  const parts = [];
  if (result.scenesMoved > 0) {
    parts.push(`moved ${result.scenesMoved} ${result.scenesMoved === 1 ? "scene" : "scenes"}`);
  }
  if (result.renumbered > 0) {
    parts.push(`renumbered ${result.renumbered} ${result.renumbered === 1 ? "chapter" : "chapters"}`);
  }
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

// Text piped to `story <command> -`. `io.readStdin` stands in for the real
// stdin in tests.
function pipedText(io, command) {
  return stdinText(command, io.readStdin ? io.readStdin() : readStdin(command));
}

// The project for a passage piped to `story prose -` or `story voices -`:
// the `-` takes the place of [path], so the project is --path, else the
// current directory. prose also runs outside a project, with the default
// rules; voices needs the project's characters, so it reports the usual
// missing story.md error.
function passageRoot(parsed, cwd, required) {
  if (parsed.options.path !== undefined) {
    return path.resolve(cwd, parsed.options.path);
  }
  return required || fs.existsSync(path.join(cwd, "story.md")) ? path.resolve(cwd) : null;
}

// story snapshot --restore <name>. The --dry-run copy leaves out
// .snapshots/, so the snapshot being restored is copied in first, with
// every other snapshot's folder and manifest: the preview then finds it by
// the same name, and numbers its safety snapshot, as the real run does.
function runRestore(context, name) {
  const { parsed } = context;
  if (name !== undefined) {
    throw usageError("story snapshot --restore takes the snapshot's name as its value: story snapshot --restore <name>");
  }
  for (const flag of ["id", "list", "force"]) {
    if (flag === "id" ? parsed.options.id !== undefined : isTruthy(parsed.options[flag])) {
      throw usageError(`--${flag} does not apply to story snapshot --restore`);
    }
  }
  const restore = String(parsed.options.restore);
  const projectRoot = context.root();
  const seed = (target) => {
    if (target === projectRoot) {
      return;
    }
    // The copy has no nested projects or symlinks to refuse a target.
    restoreSources(projectRoot, restore);
    const folder = path.join(projectRoot, SNAPSHOTS_DIR);
    const { directory } = existingSnapshot(projectRoot, restore);
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const copy = path.join(target, SNAPSHOTS_DIR, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(copy, { recursive: true });
        const manifest = path.join(folder, entry.name, SNAPSHOT_MANIFEST);
        // Only a manifest --list can read, read as it reads one. One it
        // cannot (oversized, or not a regular file) is left out, and --list
        // names that snapshot by its folder, in the copy as in the project.
        const text = currentText(manifest);
        if (text !== null) {
          fs.writeFileSync(path.join(copy, SNAPSHOT_MANIFEST), text, "utf8");
        }
      }
    }
    fs.cpSync(directory, path.join(target, SNAPSHOTS_DIR, path.basename(directory)), { recursive: true });
  };
  return runWrite(context, "snapshot", (target) => {
    seed(target);
    return restoreSnapshot(target, { name: restore });
  }, formatRestore, formatRestorePreview);
}

// Runs a write command: `write(projectRoot)` makes the changes and
// `describe(result)` is the text output. Every file it creates, updates, or
// deletes is recorded as it happens (recordChanges), so --json lists them.
// With --dry-run the same command runs on a copy of the project instead
// (previewChanges) and the changes it made there are printed: the project
// is only read and its lock is not taken. The warnings it raises, and the
// exit code, are those of the real run.
// `detail`, when given, describes what the command changed inside the files
// (rename --prose lists each name it replaced), printed before a
// --dry-run's list of files.
function runWrite({ parsed, io, root, overrides }, command, write, describe, detail = () => "") {
  const projectRoot = root();
  const dryRun = isTruthy(parsed.options["dry-run"]);
  const { result, changes } = runOrPreview(dryRun, projectRoot, write);
  const findings = checkedWarnings(result.warnings, overrides);
  if (wantsJson(parsed)) {
    return writeJsonResult(io, {
      command,
      ok: findings.ok,
      data: { ...writeResultData(projectRoot, result), dryRun, changes },
      diagnostics: diagnosticsFrom(findings, command),
      writes: dryRun ? [] : writtenFiles(projectRoot, changes)
    });
  }
  io.stdout.write(dryRun ? `${detail(result)}${formatPreview(command, changes)}` : describe(result));
  return writeFindings(io, findings);
}

// Runs `write(projectRoot)`, recording the changes it makes, or with
// --dry-run runs it on a copy of the project (previewChanges): for a command
// that reads back what it writes.
function runOrPreview(dryRun, projectRoot, write) {
  return dryRun ? previewChanges(projectRoot, write) : recordChanges(projectRoot, () => write(projectRoot));
}

// Runs `run()`, recording the changes it makes relative to `base`, or with
// --dry-run plans them without writing (planChanges): for a command that
// only writes files it never reads back, a build or a new project.
function runOrPlan(dryRun, base, run) {
  return dryRun ? planChanges(base, run) : recordChanges(base, run);
}

// --dry-run for diagram and synopsis, which write only with --out.
function outputDryRun(parsed, command) {
  const dryRun = isTruthy(parsed.options["dry-run"]);
  if (dryRun && parsed.options.out === undefined) {
    throw usageError(`--dry-run previews ${command} --out: add --out`);
  }
  return dryRun;
}

// story import --dry-run: the import runs on a copy of the folder it would
// fill (previewNewProject), since it reindexes the chapters it writes. The
// source is read where it is.
function previewImport(io, options) {
  const { cwd } = options;
  const source = String(options.source ?? "").trim();
  const target = newProjectRoot({ title: options.title, cwd, dir: options.dir });
  const run = (dir) => importManuscript({ ...options, source: source === "" || source === STDIN_ARG ? source : path.resolve(cwd, source), dir });
  // Without a folder the import is refused before it writes anything.
  const { result, changes } = target === null ? planChanges(cwd, () => run(options.dir)) : previewNewProject(target, run);
  io.stdout.write(formatPreview("import", changes));
  reportImportNotes(io, result);
  return 0;
}

// The options a kept story.md did not take, a kept .gitignore that misses
// dist/, the warnings import found in the manuscript, and what replacing an
// existing project's chapters may have broken.
function reportImportNotes(io, result) {
  reportKeptStory(io, result, "--title");
  reportGitignore(io, result);
  for (const warning of result.warnings) {
    io.stderr.write(`warning: ${findingLine(warning)}\n`);
  }
  if (result.keptStory) {
    io.stderr.write("note: the old chapter files were replaced, so scenes, bible entries, and continuity files may point at chapters that are gone or changed. Run story links to find them.\n");
  }
}

// Why rename --prose left a match for the writer to check.
const REVIEW_REASONS = {
  "ordinary-word": "may be an ordinary word",
  "reference-label": "also the label of a reference link"
};

// rename --prose: each name replaced in chapter prose, as file:line:column,
// then a count, then each match left for the writer to check, with why. A
// name wrapped across lines prints on one, with the last line it changed.
function formatProseRenames(result) {
  if (!result.prose) {
    return "";
  }
  const { edits, aliases, review } = result.prose;
  const plural = (count, word, words = `${word}s`) => `${count} ${count === 1 ? word : words}`;
  const lines = edits.map((edit) => `${edit.file}:${edit.line}:${edit.column}: ${edit.from.replace(/\s+/gu, " ")} → ${edit.to.replace(/\s+/gu, " ")}${edit.endLine > edit.line ? ` (wraps to line ${edit.endLine})` : ""}\n`);
  const files = new Set(edits.map((edit) => edit.file)).size;
  const summary = edits.length === 0 ? "No names to rename in chapter prose" : `Renamed ${plural(edits.length, "name")} in ${plural(files, "chapter")}`;
  // The matches left to check, listed as story mentions lists matches.
  const unsure = review.length === 0 ? "" : [
    `Left ${plural(review.length, "match", "matches")} as written; check ${review.length === 1 ? "it" : "each"} and rename it by hand if it is the name:`,
    ...review.map((entry) => `${entry.file}:${entry.line}:${entry.column}: ${entry.text.replace(/\s+/gu, " ")} (${REVIEW_REASONS[entry.reason]}): ${entry.excerpt}`)
  ].map((line) => `${line}\n`).join("");
  return `${lines.join("")}${summary}${aliases > 0 ? `; left ${plural(aliases, "alias", "aliases")} as written` : ""}\n${unsure}`;
}

// story doctor --fix: applies the safe repairs under the project lock (or,
// with --dry-run, on a copy, as runWrite does), then prints what it changed
// and the diagnosis that remains. Unlike doctor, it exits 1 while any check
// still reports an error, since those need the writer.
function runDoctorFix({ parsed, io, cwd, root }, options) {
  const projectRoot = root();
  const dryRun = isTruthy(parsed.options["dry-run"]);
  const fix = (target) => fixProject(target, options);
  const { result: report, changes } = runOrPreview(dryRun, projectRoot, fix);
  const ok = report.validation.ok && report.links.ok && report.continuity.ok;
  const { repairs, stopped, ...rest } = report;
  // Read from the real project, since a --dry-run diagnoses a copy.
  const diagnosis = withWorkflowPins(rest, projectRoot, cwd);
  if (wantsJson(parsed)) {
    return reportProjectJson(io, "doctor", { ...diagnosis, fix: { dryRun, repairs, stopped, changes } }, {
      ok,
      writes: dryRun ? [] : writtenFiles(projectRoot, changes)
    });
  }
  io.stdout.write(`${formatRepairs(repairs, stopped, changes, dryRun)}\n${formatDoctorReport(diagnosis)}`);
  return ok ? EXIT_CODES.ok : EXIT_CODES.findings;
}

// doctor's report with a P3 action for each copied workflow that pins an
// older CLI or still uses STORY_REF (see workflows.js). With any, the
// "Project is mechanically healthy" action no longer holds and is dropped.
function withWorkflowPins(report, projectRoot, cwd) {
  const pins = workflowPinActions(projectRoot, cwd);
  if (pins.length === 0) {
    return report;
  }
  const actions = report.actions.filter((item) => item.title !== "Project is mechanically healthy");
  return { ...report, actions: [...actions, ...pins] };
}

// The repairs doctor --fix applied, each with the changes it made.
function formatRepairs(repairs, stopped, changes, dryRun) {
  const lines = [dryRun ? "Repairs (dry run; nothing was written):" : "Repairs:"];
  if (repairs.length === 0 && stopped === null) {
    lines.push("- No safe repairs needed");
  }
  for (const repair of repairs) {
    const count = repair.changes.length === 0 ? "no changes" : `${repair.changes.length} ${repair.changes.length === 1 ? "change" : "changes"}`;
    lines.push(`- story ${repair.command} (${repair.codes.join(", ")}): ${count}`);
    for (const change of repair.changes) {
      lines.push(`  ${change.action.padEnd(7)} ${change.path}`);
    }
  }
  if (stopped !== null) {
    lines.push(`- Stopped: ${stopped}`);
  }
  if (dryRun) {
    lines.push(`Dry run: story doctor --fix would make ${changes.length === 0 ? "no changes" : `${changes.length} ${changes.length === 1 ? "change" : "changes"}`}; the checks below are what would remain`);
  }
  return `${lines.join("\n")}\n`;
}

// The absolute paths of the files a run created or updated, for --json writes.
function writtenFiles(projectRoot, changes) {
  return changes.filter((change) => change.action === "create" || change.action === "update").map((change) => path.resolve(projectRoot, change.path));
}

// The changes a --dry-run would make, one per line, then a summary.
function formatPreview(command, changes) {
  const lines = changes.map((change) => `${change.action.padEnd(7)} ${change.path}\n`).join("");
  const count = changes.length === 0 ? "no changes" : `${changes.length} ${changes.length === 1 ? "change" : "changes"}`;
  return `${lines}Dry run: story ${command} would make ${count}; nothing was written\n`;
}

// A write command's result as --json data: its file relative to the
// project, without the absolute paths that data.changes replaces.
function writeResultData(projectRoot, result) {
  const { warnings, changed, root, ...data } = result;
  return typeof data.file === "string" ? { ...data, file: path.relative(projectRoot, data.file).split(path.sep).join("/") } : data;
}

// The parsed options an entity command passes on, without the output flags.
function entityOptions(parsed) {
  const { json, "dry-run": dryRun, ...options } = parsed.options;
  return options;
}

// Warnings a command reports after its own output, with the story.md
// severity overrides and code exemptions applied.
function checkedWarnings(warnings = [], overrides) {
  return applySeverity({ ok: true, errors: [], warnings }, overrides);
}

// The findings of a command that reports them after its own output (a
// build, an add, a drafting context): no summary line, and exit 1 only when
// story.md severity promoted a warning to an error.
function writeFindings(io, result) {
  printFindings(io, result);
  return result.ok ? EXIT_CODES.ok : EXIT_CODES.findings;
}

// The project path as typed, for commands the reports suggest.
function displayPath(parsed) {
  const flag = parsed.options.path;
  return parsed.positionals[1] ?? (Array.isArray(flag) ? flag[flag.length - 1] : flag) ?? ".";
}

// init and import --force keep an existing story.md, so name the options it
// did not take rather than report them applied.
function reportKeptStory(io, result, titleLabel) {
  if (!result.keptStory || result.ignoredOptions.length === 0) {
    return;
  }
  const names = result.ignoredOptions.map((name) => (name === "title" ? titleLabel : name));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  io.stderr.write(`warning: ${findingLine(warn("kept-story-options", `story.md already exists and was kept, so ${list} ${names.length === 1 ? "was" : "were"} not applied. Edit story.md to change ${names.length === 1 ? "it" : "them"}.`, "story.md"))}\n`);
}

// An existing .gitignore is never edited, so say when builds would be
// committed with it.
function reportGitignore(io, result) {
  if (result.gitignore === "missing-dist") {
    io.stderr.write("note: .gitignore was kept and does not ignore dist/, so builds would be committed. Add a dist/ line to keep them out.\n");
  }
}

// --theme keeps each value whole; --themes splits on commas.
function collectThemes(options) {
  return optionValues(options, "theme").concat(optionValues(options, "themes"));
}

// validate, links, and continuity: the findings are the whole result, so
// --json data is only their counts.
function reportCheck(parsed, io, command, result, successMessage, failureMessage) {
  if (wantsJson(parsed)) {
    return writeJsonResult(io, {
      command,
      ok: result.ok,
      data: checkCounts(result),
      diagnostics: diagnosticsFrom(result, command)
    });
  }
  return reportResult(io, result, successMessage, failureMessage);
}

// An analysis result as --json: its findings become diagnostics and the rest
// of the result is the data. A finding about a piped passage (`prose -`,
// `voices -`) names no project file, so its file is the passage, stdin.
function reportJson(io, command, result, { writes = [], passage = false } = {}) {
  const diagnostics = diagnosticsFrom(result, command).map((entry) => (passage && entry.file === null ? { ...entry, file: STDIN_LABEL } : entry));
  return writeJsonResult(io, { command, ok: result.ok, data: resultData(result), diagnostics, writes });
}

// story compare --json: both modes, and every chapter and label in them,
// have the same keys, so a field the mode or entry lacks is null.
function compareData(comparison) {
  const anchors = comparison.anchors !== undefined;
  return {
    ...comparison,
    mode: anchors ? "anchors" : "chapters",
    chapters: anchors ? null : comparison.chapters.map((chapter) => ({ ...chapter, movedFrom: chapter.movedFrom ?? null })),
    beforeChapters: comparison.beforeChapters ?? null,
    afterChapters: comparison.afterChapters ?? null,
    beforeWords: comparison.beforeWords ?? null,
    afterWords: comparison.afterWords ?? null,
    anchors: anchors ? comparison.anchors.map((entry) => ({ to: null, similarity: null, excerpt: null, ...entry })) : null
  };
}

// story passes --json: each recorded pass with the focus and check commands
// of a default pass (null for a custom one), pointed at the project as the
// text output points them.
function passesData(result, where) {
  const defaults = new Map(DEFAULT_PASSES.map((entry) => [entry.pass, entry]));
  const passes = result.passes.map((entry) => {
    const known = defaults.get(entry.pass);
    return { pass: entry.pass, status: entry.status, focus: known?.focus ?? null, checks: known ? passChecks(known, where) : null };
  });
  return {
    passes,
    done: result.passes.filter((entry) => entry.status === "done").length,
    next: nextPass(result.passes)?.pass ?? null,
    changed: result.changed,
    notes: result.notes ?? []
  };
}

function checkCounts(result) {
  return { errors: result.errors.length, warnings: result.warnings.length, dismissed: (result.dismissed ?? []).length };
}

// report, next, and doctor run validate, links, and continuity: their
// findings become diagnostics coded by check, each listed once (see
// uniqueCheckFindings), and the data summarizes each check. These commands
// exit 0 whatever the checks find, so ok is true, except doctor --fix, which
// passes its own ok and the files it wrote.
// `diagnostics` are the command's own findings, after the checks'.
function reportProjectJson(io, command, report, { ok = true, writes = [], diagnostics: own = [] } = {}) {
  const { validation, links, continuity, ...rest } = report;
  const checks = { validate: validation, links, continuity };
  const diagnostics = [...Object.entries(uniqueCheckFindings(checks)).flatMap(([name, check]) => diagnosticsFrom(check, name)), ...own];
  return writeJsonResult(io, {
    command,
    ok,
    data: { ...rest, checks: checkSummaries(checks) },
    diagnostics,
    writes
  });
}

// Each check's own result as --json summarizes it.
function checkSummaries(checks) {
  return Object.fromEntries(Object.entries(checks).map(([name, check]) => [name, { ok: check.ok, ...checkCounts(check) }]));
}

function reportResult(io, result, successMessage, failureMessage) {
  const dismissed = result.dismissed ?? [];
  io.stderr.write(`${result.ok ? successMessage : failureMessage}: ${result.errors.length} errors, ${result.warnings.length} warnings, ${dismissed.length} dismissed\n`);

  printFindings(io, result);
  return result.ok ? EXIT_CODES.ok : EXIT_CODES.findings;
}

// One line on stderr per error, warning, and dismissed finding.
function printFindings(io, result) {
  for (const error of result.errors) {
    io.stderr.write(`error: ${findingLine(error)}\n`);
  }
  for (const warning of result.warnings) {
    io.stderr.write(`warning: ${findingLine(warning)}\n`);
  }
  for (const entry of result.dismissed ?? []) {
    io.stderr.write(`dismissed: ${entry.finding.message} (${entry.note ?? `exemption: ${entry.reason}`})\n`);
  }
}

// A finding as the text output prints it. A warning, or a warning that
// severity promoted to an error, ends with its code, the name a story.md
// severity entry takes; errors cannot be overridden, so they print without.
function findingLine(finding) {
  return FINDING_CODES[finding.code] === "warning" ? `${finding.message} [${finding.code}]` : finding.message;
}

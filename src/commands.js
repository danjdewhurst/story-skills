import fs from "node:fs";
import path from "node:path";
import { formatClueMatrix } from "./clues.js";
import { formatKnowledgeMark } from "./chronology.js";
import { formatContext } from "./context.js";
import { formatComparison, formatLabelMapping } from "./compare.js";
import { applySeverity } from "./config.js";
import { FINDING_CODES, warn } from "./findings.js";
import { importManuscript } from "./import.js";
import { recordChanges } from "./files.js";
import { diagnosticsFrom, resultData, wantsJson, writeJsonResult } from "./json.js";
import { previewChanges } from "./preview.js";
import { isTruthy } from "./options.js";
import { STDIN_ARG, readStdin, stdinText } from "./stdin.js";
import { formatNames } from "./names.js";
import { formatPacing } from "./pacing.js";
import { formatPasses } from "./passes.js";
import { formatProgress } from "./progress.js";
import { formatStateChanges } from "./progressions.js";
import { formatProseReport } from "./prose.js";
import { formatSeriesReport } from "./series.js";
import { formatSimilarity } from "./similarity.js";
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
  draftingContext,
  exportManuscript,
  formatActionReport,
  formatDoctorReport,
  formatProjectReport,
  knowledgeAtChapter,
  migrateProject,
  moveEntity,
  namesReport,
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

// Options accepted by `story add`; each entity kind reads the ones it needs.
const ADD_OPTIONS = [
  "id", "number", "chapter", "scene", "type", "role", "status", "mode", "date", "time", "travel-hours", "dilemma",
  "sequel", "outcome", "hook", "location", "locations", "character", "characters", "mention", "mentions",
  "member", "members", "owner", "arc", "arcs", "introduced", "resolved", "planted", "payoff",
  "significance-delayed", "red-herring", "category", "alias", "aliases", "region", "population",
  "controlled-by", "prevalence", "acts", "act", "placement", "order", "heading", "source", "sources", "used-in",
  "accuracy", "confidence", "method", "risk", "theme", "themes", "pov"
];

// The flags of every command that writes the project in place: --dry-run
// previews the changes and --json reports them (see runWrite).
const WRITE_OPTIONS = ["dry-run", "json"];

// Every CLI command, in help order. `project` says how the command finds its
// story project: "positional" takes an optional path as its first argument
// (or --path), "flag" takes only --path, and "none" means the command makes a
// new project and refuses --path. `args` caps the positional arguments after
// the command name (default: 1 for "positional", 0 otherwise) and `options`
// lists the flags the command reads besides --path, so a stray argument or
// flag is an error rather than silently ignored. `run` receives
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
    options: ["dir", "genre", "sub-genre", "setting-era", "theme", "themes", "pov", "tense", "form", "synopsis", "series", "book-number", "follows", "precedes", "force"],
    run({ parsed, io, cwd }) {
      const result = createStoryProject({
        title: parsed.positionals.slice(1).join(" "),
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
      });
      io.stdout.write(`${result.keptStory ? "Updated" : "Created"} story project: ${result.root}\n`);
      reportKeptStory(io, result, "the title");
      reportGitignore(io, result);
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
    options: ["title", "dir", "genre", "sub-genre", "setting-era", "theme", "themes", "pov", "tense", "synopsis", "language", "force"],
    run({ parsed, io, cwd }) {
      const result = importManuscript({
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
      });
      const [length, noun] = result.characters === undefined ? [result.words, "word"] : [result.characters, "character"];
      io.stdout.write(`Imported ${result.chapters} ${result.chapters === 1 ? "chapter" : "chapters"} (${length} ${length === 1 ? noun : `${noun}s`}) into ${result.root}\n`);
      reportKeptStory(io, result, "--title");
      reportGitignore(io, result);
      for (const warning of result.warnings) {
        io.stderr.write(`warning: ${findingLine(warning)}\n`);
      }
      if (result.keptStory) {
        io.stderr.write("note: the old chapter files were replaced, so scenes, bible entries, and continuity files may point at chapters that are gone or changed. Run story links to find them.\n");
      }
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
      "requires --ref or --against; --anchor maps old",
      "review-copy labels to the current paragraphs"
    ],
    project: "positional",
    options: ["ref", "against", "anchor"],
    run({ parsed, io, cwd, root, overrides }) {
      const comparison = applySeverity(compareProject(root(), { ref: parsed.options.ref, against: parsed.options.against, anchors: parsed.options.anchor, cwd }), overrides);
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
      "git ref); advisory, never proof of copying"
    ],
    project: "positional",
    options: ["against", "min-words", "json"],
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
      "targets, and logged sessions; --log records today"
    ],
    project: "positional",
    options: ["log", "date", "json"],
    run({ parsed, io, root, overrides }) {
      const progress = applySeverity(projectProgress(root(), { log: isTruthy(parsed.options.log), date: parsed.options.date }), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "progress", progress, { writes: progress.logged ? [progress.logged.file] : [] });
      }
      if (progress.logged) {
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
    options: ["out"],
    run({ parsed, io, root }) {
      const result = diagramProject(root(), { kind: parsed.positionals[1], out: parsed.options.out });
      if (result.ok) {
        io.stdout.write(result.outFile === undefined ? result.text : `Wrote ${parsed.positionals[1]} diagram to ${result.outFile}\n`);
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
    run({ parsed, io, cwd, root, overrides }) {
      const report = applySeverity(namesReport(root(), nameWords(parsed, 1, cwd, "names")), overrides);
      io.stdout.write(formatNames(report));
      return reportResult(io, report, "Names checked", "Name check failed");
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
    options: ["init", "start", "done"],
    run({ parsed, io, root }) {
      const result = projectPasses(root(), {
        init: isTruthy(parsed.options.init),
        start: parsed.options.start,
        done: parsed.options.done
      });
      for (const note of result.notes ?? []) {
        io.stderr.write(`note: ${note}\n`);
      }
      if (result.changed) {
        io.stdout.write("Updated revision-passes in story.md\n");
      }
      const where = shellWord(displayPath(parsed));
      io.stdout.write(formatPasses(result.passes, where === "." ? "story passes" : `story passes ${where}`));
      return 0;
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
    summary: ["Recommend the next writing and maintenance actions"],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const report = projectActions(root(), { displayPath: displayPath(parsed), overrides });
      if (wantsJson(parsed)) {
        return reportProjectJson(io, "next", report);
      }
      io.stdout.write(formatActionReport(report));
      return 0;
    }
  },
  {
    name: "doctor",
    usage: "doctor [path]",
    summary: ["Show health checks plus actionable repair steps"],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const report = projectActions(root(), { displayPath: displayPath(parsed), overrides });
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
    options: [...ADD_OPTIONS, ...WRITE_OPTIONS],
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
    options: ["id", ...WRITE_OPTIONS],
    run(context) {
      const { parsed, cwd } = context;
      const options = {
        ...entityOptions(parsed),
        kind: parsed.positionals[1],
        // The positional names the entity being renamed; --id, when given, is
        // the id it moves to instead of one derived from the new name.
        id: parsed.positionals[2],
        newId: parsed.options.id,
        name: nameWords(parsed, 3, cwd, "rename").join(" ")
      };
      return runWrite(context, "rename", (projectRoot) => renameEntity(projectRoot, options),
        (result) => `${result.resumed ? "Finished an interrupted rename of" : "Renamed"} ${result.kind} ${result.oldId} to ${result.id}: ${result.file}\n`);
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
    name: "export",
    usage: "export [path]",
    summary: ["Combine front matter, chapters, and back matter into a", "manuscript markdown file"],
    project: "positional",
    options: ["out"],
    run({ parsed, io, root, overrides }) {
      const result = exportManuscript(root(), { out: parsed.options.out });
      io.stdout.write(`Exported ${result.chapters} chapters to ${result.outFile}\n`);
      return writeFindings(io, checkedWarnings(result.warnings, overrides));
    }
  },
  {
    name: "build",
    usage: "build [path]",
    summary: [
      "Build a disposable book artifact in dist/: markdown,",
      "epub, docx, shunn, html (review copy with paragraph",
      "anchors), print (paged-media interior),",
      "narration (audiobook script), metadata (retailer",
      "sheet), fountain (screenplay scene skeleton),",
      "twee (Twine story from chapter choices), or ink",
      "(ink story from chapter choices)"
    ],
    project: "positional",
    options: ["out", "format", "shunn", "trim", "stamp", "note-url"],
    run({ parsed, io, root, overrides }) {
      const result = buildBook(root(), {
        out: parsed.options.out,
        format: parsed.options.format,
        shunn: isTruthy(parsed.options.shunn),
        trim: parsed.options.trim,
        stamp: parsed.options.stamp,
        noteUrl: parsed.options["note-url"]
      });
      io.stdout.write(`Built ${result.chapters} chapters as ${result.format} to ${result.outFile}\n`);
      return writeFindings(io, checkedWarnings(result.warnings, overrides));
    }
  },
  {
    name: "synopsis",
    usage: "synopsis [path]",
    summary: ["Build a deterministic 1- or 3-page synopsis from arcs"],
    project: "positional",
    options: ["pages", "out"],
    run({ parsed, io, root }) {
      const result = synopsisBook(root(), { pages: parsed.options.pages, out: parsed.options.out });
      if (result.outFile === undefined) {
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

// Warnings a command reports after its own output, with the story.md
// severity overrides and code exemptions applied.
// Runs a write command: `write(projectRoot)` makes the changes and
// `describe(result)` is the text output. Every file it creates, updates, or
// deletes is recorded as it happens (recordChanges), so --json lists them.
// With --dry-run the same command runs on a copy of the project instead
// (previewChanges) and the changes it made there are printed: the project
// is only read and its lock is not taken. The warnings it raises, and the
// exit code, are those of the real run.
function runWrite({ parsed, io, root, overrides }, command, write, describe) {
  const projectRoot = root();
  const dryRun = isTruthy(parsed.options["dry-run"]);
  const { result, changes } = dryRun ? previewChanges(projectRoot, write) : recordChanges(projectRoot, () => write(projectRoot));
  const findings = checkedWarnings(result.warnings, overrides);
  if (wantsJson(parsed)) {
    return writeJsonResult(io, {
      command,
      ok: findings.ok,
      data: { ...writeResultData(projectRoot, result), dryRun, changes },
      diagnostics: diagnosticsFrom(findings, command),
      writes: dryRun ? [] : changes.filter((change) => change.action === "create" || change.action === "update").map((change) => path.join(projectRoot, change.path))
    });
  }
  io.stdout.write(dryRun ? formatPreview(command, changes) : describe(result));
  return writeFindings(io, findings);
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

function collectThemes(options) {
  return []
    .concat(options.theme ?? [])
    .concat(options.themes ?? [])
    .filter((value) => value !== undefined && value !== true);
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

function checkCounts(result) {
  return { errors: result.errors.length, warnings: result.warnings.length, dismissed: (result.dismissed ?? []).length };
}

// report, next, and doctor run validate, links, and continuity: their
// findings become diagnostics coded by check, each listed once (see
// uniqueCheckFindings), and the data summarizes each check. These commands
// exit 0 whatever the checks find, so ok is true.
function reportProjectJson(io, command, report) {
  const { validation, links, continuity, ...rest } = report;
  const checks = { validate: validation, links, continuity };
  const diagnostics = Object.entries(uniqueCheckFindings(checks)).flatMap(([name, check]) => diagnosticsFrom(check, name));
  return writeJsonResult(io, {
    command,
    ok: true,
    data: { ...rest, checks: checkSummaries(checks) },
    diagnostics
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

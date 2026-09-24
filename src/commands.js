import path from "node:path";
import { formatClueMatrix } from "./clues.js";
import { formatComparison } from "./compare.js";
import { importManuscript } from "./import.js";
import { isTruthy } from "./options.js";
import { formatNames } from "./names.js";
import { formatPacing } from "./pacing.js";
import { formatPasses } from "./passes.js";
import { formatProgress } from "./progress.js";
import { formatProseReport } from "./prose.js";
import { formatSeriesReport } from "./series.js";
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
  exportManuscript,
  formatActionReport,
  formatDoctorReport,
  formatProjectReport,
  knowledgeAtChapter,
  migrateProject,
  namesReport,
  pacingReport,
  projectPasses,
  projectActions,
  projectProgress,
  projectReport,
  proseReport,
  reindexProject,
  removeEntity,
  renameEntity,
  seriesReport,
  storyTimeline,
  synopsisBook,
  validateLinks,
  validateProject,
  voicesReport
} from "./story.js";

// Every CLI command, in help order. `project` says how the command finds its
// story project: "positional" takes an optional path as its first argument
// (or --path), "flag" takes only --path, and "none" means the command makes a
// new project and refuses --path. `run` receives { parsed, io, cwd, root },
// where root() resolves the project path, and returns the exit code.
export const COMMANDS = [
  {
    name: "init",
    usage: "init <title>",
    summary: ["Scaffold a story project"],
    project: "none",
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
        synopsis: parsed.options.synopsis,
        series: parsed.options.series,
        bookNumber: parsed.options["book-number"],
        follows: parsed.options.follows,
        precedes: parsed.options.precedes,
        force: isTruthy(parsed.options.force)
      });
      io.stdout.write(`Created story project: ${result.root}\n`);
      for (const linkedBook of result.linkedBooks) {
        io.stdout.write(`Linked series backlink in ${path.join(linkedBook, "story.md")}\n`);
      }
      return 0;
    }
  },
  {
    name: "import",
    usage: "import <source>",
    summary: ["Split an existing manuscript into a new story project"],
    project: "none",
    run({ parsed, io, cwd }) {
      const result = importManuscript({
        source: parsed.positionals[1],
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
        force: isTruthy(parsed.options.force)
      });
      io.stdout.write(`Imported ${result.chapters} chapters (${result.words} words) into ${result.root}\n`);
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
    run: ({ io, root }) => reportResult(io, validateProject(root()), "Project is valid", "Project validation failed")
  },
  {
    name: "reindex",
    usage: "reindex [path]",
    summary: ["Rebuild registry tables from markdown files"],
    project: "positional",
    run({ io, root }) {
      const result = reindexProject(root());
      io.stdout.write(result.changed.length === 0
        ? "Registries already up to date\n"
        : `Updated ${result.changed.length} registries\n`);
      return 0;
    }
  },
  {
    name: "wordcount",
    usage: "wordcount [path]",
    summary: ["Count chapter prose words"],
    project: "positional",
    run({ parsed, io, root }) {
      const result = computeWordCounts(root(), { write: isTruthy(parsed.options.write) });
      for (const chapter of result.chapters) {
        io.stdout.write(`${chapter.file}: ${chapter.wordCount}\n`);
      }
      io.stdout.write(`Total: ${result.total}\n`);
      return 0;
    }
  },
  {
    name: "links",
    usage: "links [path]",
    summary: ["Check cross-reference targets and backlinks"],
    project: "positional",
    run: ({ io, root }) => reportResult(io, validateLinks(root()), "Links are valid", "Link check failed")
  },
  {
    name: "continuity",
    usage: "continuity [path]",
    summary: [
      "Check deterministic continuity contracts: deaths,",
      "promises, questions, casts, and durable state.",
      "Findings matching continuity/exemptions.md are",
      "reported as dismissed"
    ],
    project: "positional",
    run: ({ io, root }) => reportResult(io, checkProjectContinuity(root()), "Continuity is consistent", "Continuity check failed")
  },
  {
    name: "knowledge",
    usage: "knowledge <id>",
    summary: ["List what a character knew at a chapter; requires --at"],
    project: "flag",
    run({ parsed, io, root }) {
      const characterId = parsed.positionals[1];
      const atChapterId = parsed.options.at;
      if (!characterId || typeof atChapterId !== "string") {
        io.stderr.write("Usage: story knowledge <character-id> --at <chapter-id> [--path <project>]\n");
        return 1;
      }
      const entries = knowledgeAtChapter(root(), characterId, atChapterId);
      if (entries.length === 0) {
        io.stdout.write(`No recorded knowledge for ${characterId} at ${atChapterId}\n`);
        return 0;
      }
      for (const entry of entries) {
        const source = entry.learnedIn === "" ? "pre-existing knowledge" : `learned in ${entry.learnedIn}`;
        io.stdout.write(`- ${entry.knows} (${source})\n`);
      }
      return 0;
    }
  },
  {
    name: "compare",
    usage: "compare [path]",
    summary: [
      "Compare chapters with an earlier draft: word changes,",
      "added and removed chapters, and unchanged paragraphs;",
      "requires --ref or --against"
    ],
    project: "positional",
    run({ parsed, io, cwd, root }) {
      const comparison = compareProject(root(), { ref: parsed.options.ref, against: parsed.options.against, cwd });
      io.stdout.write(formatComparison(comparison, comparison.label));
      return reportResult(io, comparison, "Comparison complete", "Comparison failed");
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
    run({ parsed, io, root }) {
      const progress = projectProgress(root(), { log: isTruthy(parsed.options.log), date: parsed.options.date });
      if (progress.logged) {
        io.stdout.write(`Logged ${progress.logged.words} words for ${progress.logged.date} in ${progress.logged.file}\n`);
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
    run({ io, root }) {
      const timeline = storyTimeline(root());
      io.stdout.write(formatTimeline(timeline, timeline.totalChapters));
      return reportResult(io, timeline, "Timeline built", "Timeline failed");
    }
  },
  {
    name: "prose",
    usage: "prose [path]",
    summary: [
      "Lint chapter prose: filter words, adverbs, dialogue",
      "tags, echoes, rhythm, repeated phrases, similar",
      "names, and style-sheet.md spellings and watch words"
    ],
    project: "positional",
    run({ io, root }) {
      const report = proseReport(root());
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
    run({ parsed, io, root }) {
      const result = diagramProject(root(), { kind: parsed.positionals[1], out: parsed.options.out });
      io.stdout.write(result.outFile === undefined ? result.text : `Wrote ${parsed.positionals[1]} diagram to ${result.outFile}\n`);
      return 0;
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
    run({ parsed, io, root }) {
      const report = namesReport(root(), parsed.positionals.slice(1));
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
    run({ io, root }) {
      const report = pacingReport(root());
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
    run({ io, root }) {
      const report = clueReport(root());
      io.stdout.write(formatClueMatrix(report));
      return reportResult(io, report, "Clue check complete", "Clue check failed");
    }
  },
  {
    name: "voices",
    usage: "voices [path]",
    summary: [
      "Fingerprint each character's tagged dialogue and flag",
      "voice-avoid words, unused voice-words, and",
      "characters who sound alike"
    ],
    project: "positional",
    run({ io, root }) {
      const report = voicesReport(root());
      io.stdout.write(formatVoices(report));
      return reportResult(io, report, "Voice check complete", "Voice check failed");
    }
  },
  {
    name: "series",
    usage: "series [path]",
    summary: ["Order linked prequels and sequels and check shared", "canon across books"],
    project: "positional",
    run({ io, root }) {
      const report = seriesReport(root());
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
    run({ parsed, io, root }) {
      const result = projectPasses(root(), {
        init: isTruthy(parsed.options.init),
        start: parsed.options.start,
        done: parsed.options.done
      });
      if (result.changed) {
        io.stdout.write("Updated revision-passes in story.md\n");
      }
      io.stdout.write(formatPasses(result.passes));
      return 0;
    }
  },
  {
    name: "report",
    usage: "report [path]",
    summary: ["Summarize project inventory, progress, and checks"],
    project: "positional",
    run({ parsed, io, root }) {
      io.stdout.write(formatProjectReport(projectReport(root()), { actionable: isTruthy(parsed.options.actionable) }));
      return 0;
    }
  },
  {
    name: "next",
    usage: "next [path]",
    summary: ["Recommend the next writing and maintenance actions"],
    project: "positional",
    run({ io, root }) {
      io.stdout.write(formatActionReport(projectActions(root())));
      return 0;
    }
  },
  {
    name: "doctor",
    usage: "doctor [path]",
    summary: ["Show health checks plus actionable repair steps"],
    project: "positional",
    run({ io, root }) {
      io.stdout.write(formatDoctorReport(projectActions(root())));
      return 0;
    }
  },
  {
    name: "migrate",
    usage: "migrate [path]",
    summary: ["Upgrade a project to the current schema"],
    project: "positional",
    run({ io, root }) {
      const result = migrateProject(root());
      io.stdout.write(result.changed.length === 0
        ? "Project already uses the current schema\n"
        : `Migrated project to current schema: ${result.changed.length} changes\n`);
      return 0;
    }
  },
  {
    name: "add",
    usage: "add <kind> <name>",
    summary: ["Create an entity file and reindex registries"],
    project: "flag",
    run({ parsed, io, root }) {
      const result = createEntity(root(), {
        ...parsed.options,
        kind: parsed.positionals[1],
        name: parsed.positionals.slice(2).join(" ")
      });
      io.stdout.write(`Created ${result.kind} ${result.id}: ${result.file}\n`);
      return 0;
    }
  },
  {
    name: "rename",
    usage: "rename <kind> <id> <name>",
    summary: ["Rename an entity and update id references"],
    project: "flag",
    run({ parsed, io, root }) {
      const result = renameEntity(root(), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2],
        name: parsed.positionals.slice(3).join(" ")
      });
      io.stdout.write(`Renamed ${result.kind} ${result.oldId} to ${result.id}: ${result.file}\n`);
      return 0;
    }
  },
  {
    name: "remove",
    usage: "remove <kind> <id>",
    summary: ["Remove an entity and scrub id references"],
    project: "flag",
    run({ parsed, io, root }) {
      const result = removeEntity(root(), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2]
      });
      io.stdout.write(`Removed ${result.kind} ${result.id}: ${result.file}\n`);
      return 0;
    }
  },
  {
    name: "export",
    usage: "export [path]",
    summary: ["Combine front matter, chapters, and back matter into a", "manuscript markdown file"],
    project: "positional",
    run({ parsed, io, root }) {
      const result = exportManuscript(root(), { out: parsed.options.out });
      io.stdout.write(`Exported ${result.chapters} chapters to ${result.outFile}\n`);
      return 0;
    }
  },
  {
    name: "build",
    usage: "build [path]",
    summary: ["Build a disposable book artifact in dist/; EPUB", "builds use the story.md cover image"],
    project: "positional",
    run({ parsed, io, root }) {
      const result = buildBook(root(), {
        out: parsed.options.out,
        format: parsed.options.format,
        shunn: isTruthy(parsed.options.shunn)
      });
      io.stdout.write(`Built ${result.chapters} chapters as ${result.format} to ${result.outFile}\n`);
      return 0;
    }
  },
  {
    name: "synopsis",
    usage: "synopsis [path]",
    summary: ["Build a deterministic 1- or 3-page synopsis from arcs"],
    project: "positional",
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

function collectThemes(options) {
  return []
    .concat(options.theme ?? [])
    .concat(options.themes ?? [])
    .filter((value) => value !== undefined && value !== true);
}

function reportResult(io, result, successMessage, failureMessage) {
  const dismissed = result.dismissed ?? [];
  io.stderr.write(`${result.ok ? successMessage : failureMessage}: ${result.errors.length} errors, ${result.warnings.length} warnings, ${dismissed.length} dismissed\n`);

  for (const error of result.errors) {
    io.stderr.write(`error: ${error}\n`);
  }

  for (const warning of result.warnings) {
    io.stderr.write(`warning: ${warning}\n`);
  }

  for (const entry of dismissed) {
    io.stderr.write(`dismissed: ${entry.finding} (exemption: ${entry.reason})\n`);
  }

  return result.ok ? 0 : 1;
}

// Project report and the next-action planner.
import { checkContinuity } from "./continuity.js";
import { characterCount, wordCount } from "./markdown.js";
import { applySeverity } from "./config.js";
import { DEFAULT_PASSES, nextPass, passChecks, readPasses } from "./passes.js";
import { formatPercent, todayOption } from "./progress.js";
import { formatNextRelease, projectRelease, releaseData } from "./release-schedule.js";
import { plural } from "./plural.js";
import {
  scanProject,
  relative
} from "./scan.js";
import {
  validateProjectOf,
  validateLinksOf
} from "./validate.js";

// validate, links, and continuity over one scan, with the story.md severity
// overrides and code exemptions applied as those commands apply them.
function projectChecks(project, overrides) {
  return {
    validation: applySeverity(validateProjectOf(project), overrides),
    links: applySeverity(validateLinksOf(project), overrides),
    continuity: applySeverity(checkContinuity(project), overrides)
  };
}

// A finding code one check reports, and the code of the finding another
// check reports about the same problem more precisely: a chapter date of
// 2024-13-45 is a validate invalid-date error and a continuity
// malformed-date warning. On the same file, the first is left out.
const SUPERSEDED_BY = new Map([["malformed-date", "invalid-date"]]);

// The checks' results with each finding reported once: a finding another
// check already raised (a file that fails to parse is reported by every
// check) is kept under the first check, in the given order, and one
// SUPERSEDED_BY names is dropped when the more precise finding is there.
// Every other field of each result is kept.
export function uniqueCheckFindings(checks) {
  const reported = new Set();
  for (const check of Object.values(checks)) {
    for (const finding of [...check.errors, ...check.warnings]) {
      reported.add(`${finding.code}\n${finding.file}`);
    }
  }
  const seen = new Set();
  const keep = (severity, finding) => {
    const by = SUPERSEDED_BY.get(finding.code);
    if (by !== undefined && reported.has(`${by}\n${finding.file}`)) {
      return false;
    }
    const key = `${severity}\n${finding.code}\n${finding.file}\n${finding.message}`;
    return !seen.has(key) && Boolean(seen.add(key));
  };
  return Object.fromEntries(Object.entries(checks).map(([name, check]) => [name, {
    ...check,
    errors: check.errors.filter((finding) => keep("error", finding)),
    warnings: check.warnings.filter((finding) => keep("warning", finding)),
    dismissed: (check.dismissed ?? []).filter((entry) => keep("dismissed", entry.finding))
  }]));
}

// story check: validate, links, and continuity over one scan. `checks` holds
// each check's own result, as the command of that name reports it;
// `findings` holds them again with each finding reported once (see
// uniqueCheckFindings) and, with `strict`, every warning made an error.
// errors, warnings, and dismissed are those findings in check order.
export function projectCheck(root, options = {}) {
  const project = scanProject(root);
  const { validation, links, continuity } = projectChecks(project, options.overrides);
  const checks = { validate: validation, links, continuity };
  const unique = uniqueCheckFindings(checks);
  const findings = options.strict
    ? Object.fromEntries(Object.entries(unique).map(([name, check]) => [name, { ...check, errors: [...check.errors, ...check.warnings], warnings: [] }]))
    : unique;
  const all = Object.values(findings);
  const errors = all.flatMap((check) => check.errors);
  return {
    root: project.root,
    ok: errors.length === 0,
    errors,
    warnings: all.flatMap((check) => check.warnings),
    dismissed: all.flatMap((check) => check.dismissed),
    strict: Boolean(options.strict),
    checks,
    findings
  };
}

export function projectReport(root, options = {}) {
  const project = scanProject(root);
  const { validation, links, continuity } = projectChecks(project, options.overrides);
  const totalWords = project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  // `unit` is the count unit. The word counts keep their meaning in every
  // book; the character counts and target are null in a book counted in
  // words.
  const characters = project.unit.name === "characters";
  const targetCharacters = project.story.data["target-characters"];

  return {
    root: project.root,
    title: project.title,
    storyId: project.storyId,
    schemaVersion: project.story.data["schema-version"],
    series: project.story.data.series,
    bookNumber: project.story.data["book-number"],
    genre: project.story.data.genre,
    subGenre: project.story.data["sub-genre"],
    form: typeof project.story.data.form === "string" ? project.story.data.form : "",
    status: project.story.data.status,
    pov: project.story.data.pov,
    tense: project.story.data.tense,
    unit: project.unit.name,
    targetWords: Number.isInteger(project.story.data["target-words"]) ? project.story.data["target-words"] : null,
    targetCharacters: characters && Number.isInteger(targetCharacters) ? targetCharacters : null,
    counts: {
      characters: project.characters.length,
      locations: project.locations.length,
      systems: project.systems.length,
      factions: project.factions.length,
      artifacts: project.artifacts.length,
      arcs: project.arcs.length,
      chapters: project.chapters.length,
      scenes: project.scenes.length,
      questions: project.questions.length,
      promises: project.promises.length,
      clues: project.clues.length,
      glossaryTerms: project.glossaryTerms.length,
      research: project.research.length,
      words: totalWords,
      characterCount: characters ? project.chapters.reduce((sum, chapter) => sum + chapter.count, 0) : null
    },
    chapters: project.chapters.map((chapter) => ({
      number: chapter.number,
      title: chapter.title,
      status: chapter.status,
      pov: chapter.pov,
      wordCount: chapter.wordCount,
      characterCount: characters ? chapter.count : null
    })),
    arcs: project.arcs.map((arc) => ({
      name: arc.name,
      type: arc.type,
      status: arc.status,
      characters: arc.characters.length
    })),
    validation,
    links,
    continuity,
    actions: buildProjectActions(project, validation, links, continuity, options.displayPath)
  };
}

// The manuscript's length and target in the report's count unit.
function reportLengthLines(report) {
  const [name, total, target] = report.unit === "characters"
    ? ["characters", report.counts.characterCount, report.targetCharacters]
    : ["words", report.counts.words, report.targetWords];
  return [
    `- Total ${name}: ${total}`,
    ...(target > 0 ? [`- Target ${name}: ${target} (${formatPercent((total * 100) / target, 0)}%)`] : [])
  ];
}

export function formatProjectReport(report, options = {}) {
  const lines = [
    `# ${report.title}`,
    "",
    `Story ID: ${report.storyId}`,
    `Schema version: ${report.schemaVersion ?? "unset"}`,
    ...(report.series === undefined ? [] : [`Series: ${report.series}${report.bookNumber === undefined ? "" : ` (book ${report.bookNumber})`}`]),
    `Status: ${report.status ?? "unset"}`,
    `Genre: ${[report.genre, report.subGenre].filter(Boolean).join(" / ") || "unset"}`,
    ...(report.form ? [`Form: ${report.form}`] : []),
    `POV/Tense: ${report.pov ?? "unset"} / ${report.tense ?? "unset"}`,
    "",
    "Inventory:",
    `- Characters: ${report.counts.characters}`,
    `- Locations: ${report.counts.locations}`,
    `- Systems: ${report.counts.systems}`,
    `- Factions: ${report.counts.factions}`,
    `- Artifacts: ${report.counts.artifacts}`,
    `- Arcs: ${report.counts.arcs}`,
    `- Chapters: ${report.counts.chapters}`,
    `- Scenes: ${report.counts.scenes}`,
    `- Questions: ${report.counts.questions}`,
    `- Promises: ${report.counts.promises}`,
    `- Clues: ${report.counts.clues}`,
    `- Glossary terms: ${report.counts.glossaryTerms}`,
    ...(report.counts.research === 0 ? [] : [`- Research notes: ${report.counts.research}`]),
    ...reportLengthLines(report),
    "",
    "Chapters:"
  ];

  if (report.chapters.length === 0) {
    lines.push("- None");
  } else {
    for (const chapter of report.chapters) {
      const length = report.unit === "characters" ? `${chapter.characterCount} characters` : `${chapter.wordCount} words`;
      lines.push(`- ${chapter.number}. ${chapter.title} (${chapter.status}, ${length}, POV: ${chapter.pov || "unspecified"})`);
    }
  }

  lines.push("", "Arcs:");
  if (report.arcs.length === 0) {
    lines.push("- None");
  } else {
    for (const arc of report.arcs) {
      lines.push(`- ${arc.name} (${arc.type}, ${arc.status}, ${arc.characters} characters)`);
    }
  }

  lines.push(
    "",
    "Checks:",
    `- Validate: ${formatCheck(report.validation)}`,
    `- Links: ${formatCheck(report.links)}`,
    `- Continuity: ${formatCheck(report.continuity)}`
  );

  if (options.actionable) {
    lines.push("", "Next Actions:");
    appendActionLines(lines, report.actions);
  }

  return `${lines.join("\n")}\n`;
}

// With `release` (story next only), the serial release schedule too:
// `date` is "today" for it, default the local date, and the result adds
// `release` and `releaseFindings`, the schedule's own findings.
export function projectActions(root, options = {}) {
  const today = options.release ? todayOption(options.date, "next") : null;
  const project = scanProject(root);
  const { validation, links, continuity } = projectChecks(project, options.overrides);
  if (!options.release) {
    return { root: project.root, title: project.title, storyId: project.storyId, actions: buildProjectActions(project, validation, links, continuity, options.displayPath), validation, links, continuity };
  }
  const schedule = projectRelease(project, today);
  // Severity and exemptions apply, so a release-undrafted warning turned
  // off in story.md is not an action.
  const releaseFindings = applySeverity({ ok: true, errors: [], warnings: schedule?.warnings ?? [] }, options.overrides);
  const releaseActions = [...releaseFindings.errors, ...releaseFindings.warnings]
    .map((finding) => action("P1", "Draft the scheduled episode", `${finding.message}: ${finding.file === "story.md" ? "add it with story add chapter" : "draft it under ## Chapter Text"}, then run story wordcount ${shellWord(options.displayPath ?? ".")} --write.`));
  return {
    root: project.root,
    title: project.title,
    storyId: project.storyId,
    release: releaseData(schedule),
    releaseFindings,
    actions: buildProjectActions(project, validation, links, continuity, options.displayPath, releaseActions),
    validation,
    links,
    continuity
  };
}

export function formatActionReport(report) {
  const lines = [
    `# Next Writing Actions: ${report.title}`,
    "",
    `Checks: validate ${formatCheck(report.validation)}, links ${formatCheck(report.links)}, continuity ${formatCheck(report.continuity)}`
  ];
  const release = formatNextRelease(report.release);
  if (release !== null) {
    lines.push(release);
  }
  lines.push("", "Actions:");
  appendActionLines(lines, report.actions);
  return `${lines.join("\n")}\n`;
}

export function formatDoctorReport(report) {
  const lines = [
    `# Story Doctor: ${report.title}`,
    "",
    `Root: ${report.root}`,
    "",
    "Checks:",
    `- Validate: ${formatCheck(report.validation)}`,
    `- Links: ${formatCheck(report.links)}`,
    `- Continuity: ${formatCheck(report.continuity)}`,
    "",
    "Actions:"
  ];
  appendActionLines(lines, report.actions);
  return `${lines.join("\n")}\n`;
}

// `displayPath` is the project path as the user typed it, so suggested
// commands run from where the user is; it defaults to ".".
// `releaseActions` are the next command's release schedule actions.
function buildProjectActions(project, validation, links, continuity, displayPath = ".", releaseActions = []) {
  const where = shellWord(displayPath);
  const passesCommand = where === "." ? "story passes" : `story passes ${where}`;
  const actions = [...releaseActions];
  if (validation.errors.length > 0) {
    actions.push(action("P0", "Fix validation errors", `Run story validate ${where} and repair ${validation.errors.length} schema or registry errors.`));
  }
  if (links.errors.length > 0) {
    actions.push(action("P0", "Fix broken references", `Run story links ${where} and repair ${links.errors.length} missing references or backlinks.`));
  }
  if (continuity.errors.length > 0) {
    actions.push(action("P0", "Fix continuity contradictions", `Run story continuity ${where} and repair ${continuity.errors.length} deterministic continuity errors.`));
  }
  // Stale word counts and chapters without scenes get their own actions
  // below; every other validate warning (open research a final chapter relies
  // on, an empty matter page) is reviewed here.
  const otherWarnings = validation.warnings.filter((warning) => warning.code !== "stale-word-count" && warning.code !== "no-scene-records");
  if (otherWarnings.length > 0) {
    actions.push(action("P1", "Review validation warnings", `Run story validate ${where} and review ${otherWarnings.length} warning${otherWarnings.length === 1 ? "" : "s"}.`));
  }
  if (continuity.warnings.length > 0) {
    actions.push(action("P1", "Review continuity warnings", `Run story continuity ${where} and review ${plural(continuity.warnings.length, "continuity warning")}.`));
  }
  const staleChapters = [];
  const chaptersWithoutScenes = [];
  // A warning story.md severity promoted is counted with the errors above,
  // and one it turned off is not an action.
  const overridden = (code) => new Set([...validation.errors, ...(validation.dismissed ?? []).map((entry) => entry.finding)]
    .filter((finding) => finding.code === code)
    .map((finding) => finding.file));
  const wordCountOverridden = overridden("stale-word-count");
  const scenesOverridden = overridden("no-scene-records");
  let nextNumber = 1;
  for (const chapter of project.chapters) {
    const file = relative(project, chapter.file);
    if ((chapter.declaredWordCount !== chapter.wordCount || chapter.declaredCount !== chapter.count) && !wordCountOverridden.has(file)) {
      staleChapters.push(chapter);
    }
    let hasScene = false;
    for (const scene of project.scenes) {
      if (scene.chapter === chapter.id) {
        hasScene = true;
      }
    }
    if (!hasScene && !scenesOverridden.has(file)) {
      chaptersWithoutScenes.push(chapter);
    }
    if (Number.isInteger(chapter.number) && chapter.number > 0) {
      nextNumber = Math.max(nextNumber, chapter.number + 1);
    }
  }
  if (staleChapters.length > 0) {
    actions.push(action("P1", "Refresh word counts", `Run story wordcount ${where} --write for ${plural(staleChapters.length, "chapter")} with stale counts.`));
  }
  if (chaptersWithoutScenes.length > 0) {
    actions.push(action("P1", "Add scene records", `Create machine-readable scene files for ${chaptersWithoutScenes.length} chapters so continuity has durable state.`));
  }
  // The discovery-drafting reconcile loop ends with post-hoc notes; a
  // discovered chapter without them has not been reconciled. In a
  // `draft-mode: discovered` project, a drafted chapter with no mode of its
  // own counts as discovered too.
  const projectDiscovered = project.story.data["draft-mode"] === "discovered";
  const unreconciled = project.chapters.filter((chapter) => !chapter.hasPostHocNotes
    && (chapter.mode === "discovered" || (projectDiscovered && chapter.mode === "" && chapter.wordCount > 0)));
  if (unreconciled.length > 0) {
    actions.push(action("P1", "Reconcile discovered chapters", `Run the discovery-drafting reconcile loop and add ## Chapter Notes (post-hoc) for ${unreconciled.map((chapter) => chapter.id).join(", ")}.`));
  }
  const openQuestions = [];
  for (const question of project.questions) {
    if (question.status === "open") {
      openQuestions.push(question);
    }
  }
  if (openQuestions.length > 0) {
    actions.push(action("P2", "Track open questions", openQuestions.length === 1 ? "1 mystery or continuity question is still open." : `${openQuestions.length} mysteries or continuity questions are still open.`));
  }
  const pendingPromises = [];
  for (const promise of project.promises) {
    if (promise.status === "planned" || promise.status === "planted") {
      pendingPromises.push(promise);
    }
  }
  if (pendingPromises.length > 0) {
    actions.push(action("P2", "Review promises and payoffs", pendingPromises.length === 1 ? "1 setup/payoff promise needs planting or a payoff decision." : `${pendingPromises.length} setup/payoff promises need planting or payoff decisions.`));
  }
  const openClues = [];
  for (const clue of project.clues) {
    if (clue.status === "planned" || clue.status === "planted") {
      openClues.push(clue);
    }
  }
  if (openClues.length > 0) {
    actions.push(action("P2", "Review open clues", `${openClues.length} clues are still planned or planted.`));
  }
  if (project.story.data.status === "revising") {
    const passes = readPasses(project.story.data);
    const upcoming = nextPass(passes);
    if (passes.length === 0) {
      actions.push(action("P1", "Plan revision passes", `Run ${passesCommand} --init to record the structure-to-proof pass ladder, then work one pass at a time.`));
    } else if (upcoming !== null) {
      const known = DEFAULT_PASSES.find((entry) => entry.pass === upcoming.pass);
      const checks = known ? ` Run ${passChecks(known, where).join(", ")}.` : "";
      actions.push(action("P1", `Revision pass: ${upcoming.pass}`, `${known ? `${known.focus}.` : "Work through this pass."}${checks} Mark it with ${passesCommand} --done ${upcoming.pass}.`));
    }
  }
  const activeArcNames = [];
  for (const arc of project.arcs) {
    if (arc.status !== "resolved" && activeArcNames.length < 3) {
      activeArcNames.push(arc.name);
    }
  }
  const nextLabel = activeArcNames.length > 0
    ? `advance ${activeArcNames.join(", ")}`
    : "establish the next story beat";
  const maintenanceCount = actions.length;
  // A book under revision or finished, or whose arcs are all resolved, needs
  // no new chapter.
  const storyStatus = project.story.data.status;
  const drafting = !["revising", "complete", "abandoned"].includes(storyStatus)
    && !(project.arcs.length > 0 && project.arcs.every((arc) => arc.status === "resolved"));
  // A chapter that exists but has no prose yet (an outline) comes before a
  // new one.
  const undrafted = project.chapters.find((chapter) => chapter.wordCount === 0 && Number.isInteger(chapter.number) && chapter.number > 0);
  if (drafting && undrafted) {
    actions.push(action("P2", `Draft chapter ${undrafted.number}`, `${relative(project, undrafted.file)} has no prose yet${undrafted.status === "" ? "" : ` (status ${undrafted.status})`}: draft it under ## Chapter Text to ${nextLabel}, then run story wordcount ${where} --write.`));
  } else if (drafting) {
    actions.push(action("P2", `Draft chapter ${nextNumber}`, `Use story add chapter "Chapter ${nextNumber}" --number ${nextNumber}${where === "." ? "" : ` --path ${where}`}, then outline scenes to ${nextLabel}.`));
  }
  if (project.characters.length === 0) {
    actions.push(action("P2", "Create first character", `Use story add character "Name" --role protagonist${where === "." ? "" : ` --path ${where}`} before drafting prose.`));
  }
  // Array#sort is stable (ES2019+), so actions sharing a priority keep their insertion order.
  actions.sort((left, right) => left.priority.localeCompare(right.priority, "en"));
  if (maintenanceCount === 0 && validation.ok && links.ok && continuity.ok && continuity.warnings.length === 0 && staleChapters.length === 0 && chaptersWithoutScenes.length === 0) {
    actions.push(action("P3", "Project is mechanically healthy", "No deterministic maintenance issues are blocking the next writing pass."));
  }
  return actions;
}

export function shellWord(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./~:@%+=,-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}

function action(priority, title, detail) {
  return { priority, title, detail };
}

function appendActionLines(lines, actions) {
  if (actions.length === 0) {
    lines.push("- No actions found");
    return;
  }

  for (const item of actions) {
    lines.push(`- [${item.priority}] ${item.title}: ${item.detail}`);
  }
}

function formatCheck(result) {
  const status = result.ok ? "ok" : "failed";
  return `${status} (${result.errors.length} errors, ${result.warnings.length} warnings)`;
}

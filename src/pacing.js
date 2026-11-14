// Pacing dashboard: per-chapter scene and sequel counts, scene outcomes
// (yes, no, and the yes-but/no-and extension of Swain), chapter-ending
// hooks, and length, plus advisory findings about runs that go slack. Reads
// frontmatter only; everything here is a warning.

import { warn } from "./findings.js";
import { projectPath } from "./files.js";
import { plural } from "./plural.js";

export const SCENE_OUTCOMES = new Set(["yes", "no", "yes-but", "no-and"]);
export const CHAPTER_HOOKS = new Set(["cliffhanger", "question", "revelation", "reversal", "decision", "emotional", "resolution"]);

const DRAFTED_STATUSES = new Set(["draft", "revised", "final", "complete"]);
const EASY_WIN_RUN = 3;
const NO_SEQUEL_RUN = 4;
const RESOLUTION_RUN = 3;
// Where a verse chapter sits among the scene units: it ends a run.
const RUN_BREAK = Object.freeze({ runBreak: true });

// `unit` is the project's count unit. Each row has its `words` and its
// `characterCount`, null in a book counted in words, and likewise
// `medianWords` and `medianCharacterCount`; the length findings and the
// text output use the unit.
export function buildPacing(project) {
  const characterBook = project.unit?.name === "characters";
  const inUnit = (row) => (characterBook ? row.characterCount : row.words);
  const noun = characterBook ? "characters" : "words";
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  // The chapter file a finding is about, relative to the project.
  const files = new Map(chapters.map((chapter) => [chapter.id, project.root === undefined ? null : projectPath(project.root, chapter.file)]));
  const warnings = [];
  const rows = [];
  const units = [];

  for (const chapter of chapters) {
    // A verse chapter (a poem, see isVerseChapter) is listed, but its
    // scenes, hook, and length are left out of every finding: they are
    // fiction measures. It still sits between the chapters on either side,
    // so it ends a run of scenes, as a marker in `units` says.
    const verse = chapter.verse === true;
    const scenes = project.scenes
      .filter((scene) => scene.chapter === chapter.id)
      .sort((left, right) => left.scene - right.scene || left.id.localeCompare(right.id, "en"));
    const outcomes = { yes: 0, no: 0, "yes-but": 0, "no-and": 0 };
    for (const scene of scenes) {
      if (!scene.sequel && SCENE_OUTCOMES.has(scene.outcome)) {
        outcomes[scene.outcome] += 1;
      }
      if (!verse) {
        units.push(scene);
      }
    }
    if (verse) {
      units.push(RUN_BREAK);
    }
    rows.push({
      id: chapter.id,
      number: chapter.number,
      words: chapter.wordCount,
      characterCount: characterBook ? chapter.count : null,
      scenes: scenes.filter((scene) => !scene.sequel).length,
      sequels: scenes.filter((scene) => scene.sequel).length,
      outcomes,
      hook: chapter.hook,
      status: chapter.status,
      verse
    });
    if (!verse && chapter.hook === "" && DRAFTED_STATUSES.has(chapter.status)) {
      warnings.push(warn("pacing-no-hook", `${chapter.id} has no hook: record how the chapter ending pulls the reader on`, files.get(chapter.id)));
    }
  }

  // Runs are measured across scene records in reading order.
  let easyWins = [];
  let withoutSequel = [];
  for (const unit of units) {
    if (unit === RUN_BREAK) {
      flushRun(easyWins, EASY_WIN_RUN, warnings, easyWinsWarning);
      flushRun(withoutSequel, NO_SEQUEL_RUN, warnings, noSequelWarning);
      easyWins = [];
      withoutSequel = [];
      continue;
    }
    if (unit.sequel) {
      flushRun(withoutSequel, NO_SEQUEL_RUN, warnings, noSequelWarning);
      withoutSequel = [];
      continue;
    }
    withoutSequel.push(unit);
    if (unit.outcome === "yes") {
      easyWins.push(unit);
    } else {
      flushRun(easyWins, EASY_WIN_RUN, warnings, easyWinsWarning);
      easyWins = [];
    }
  }
  flushRun(easyWins, EASY_WIN_RUN, warnings, easyWinsWarning);
  flushRun(withoutSequel, NO_SEQUEL_RUN, warnings, noSequelWarning);

  let resolutions = [];
  for (const row of rows) {
    if (!row.verse && row.hook === "resolution") {
      resolutions.push(row);
    } else {
      flushRun(resolutions, RESOLUTION_RUN, warnings, resolutionRunWarning);
      resolutions = [];
    }
  }
  flushRun(resolutions, RESOLUTION_RUN, warnings, resolutionRunWarning);

  const written = rows.filter((row) => !row.verse && inUnit(row) > 0);
  const median = medianOf(written.map(inUnit));
  if (written.length >= 3) {
    for (const row of written) {
      if (inUnit(row) > median * 2) {
        warnings.push(warn("pacing-long-chapter", `${row.id} runs ${inUnit(row)} ${noun}, over twice the median chapter (${formatMedian(median)}): consider splitting it`, files.get(row.id)));
      } else if (inUnit(row) < median / 2) {
        warnings.push(warn("pacing-short-chapter", `${row.id} runs ${inUnit(row)} ${noun}, under half the median chapter (${formatMedian(median)}): check it earns its place`, files.get(row.id)));
      }
    }
  }

  const scenes = units.filter((unit) => unit !== RUN_BREAK);
  const recorded = scenes.filter((unit) => !unit.sequel && SCENE_OUTCOMES.has(unit.outcome));
  return {
    unit: characterBook ? "characters" : "words",
    rows,
    medianWords: characterBook ? formatMedian(medianOf(rows.filter((row) => !row.verse && row.words > 0).map((row) => row.words))) : formatMedian(median),
    medianCharacterCount: characterBook ? formatMedian(median) : null,
    totals: {
      scenes: scenes.filter((unit) => !unit.sequel).length,
      sequels: scenes.filter((unit) => unit.sequel).length,
      outcomesRecorded: recorded.length,
      setbacks: recorded.filter((unit) => unit.outcome !== "yes").length,
      hooks: rows.filter((row) => !row.verse && row.hook !== "").length,
      verseChapters: rows.filter((row) => row.verse).length
    },
    warnings
  };
}

// The findings for a run that has gone on too long.
const easyWinsWarning = (run) => warn("pacing-easy-wins", `${run.length} scenes in a row end in an outright yes (${span(run)}): raise the cost with yes-but or no-and`);
const noSequelWarning = (run) => warn("pacing-no-sequel", `${run.length} scene units in a row with no sequel (${span(run)}): give the POV character room to react and decide`);
const resolutionRunWarning = (run) => warn("pacing-resolution-run", `${run.length} chapters in a row end on resolution (${span(run)}): readers can put the book down`);

function flushRun(run, minimum, warnings, message) {
  if (run.length >= minimum) {
    warnings.push(message(run));
  }
}

function span(run) {
  const first = run[0].id;
  const last = run[run.length - 1].id;
  return first === last ? first : `${first} to ${last}`;
}

// The median is compared exactly and rounded only for display.
function formatMedian(median) {
  return Math.round(median);
}

function medianOf(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function formatPacing(pacing) {
  const { totals } = pacing;
  const characterBook = pacing.unit === "characters";
  const setbackShare = totals.outcomesRecorded === 0 ? "no outcomes recorded" : `${Math.round((totals.setbacks * 100) / totals.outcomesRecorded)}% of recorded outcomes are setbacks or complications`;
  // Verse chapters are left out of the measures, so the hook share is of
  // the prose chapters.
  const verse = totals.verseChapters ?? 0;
  const lines = [
    `Pacing: ${plural(totals.scenes, "scene")}, ${plural(totals.sequels, "sequel")}, ${totals.hooks} of ${plural(pacing.rows.length - verse, verse > 0 ? "prose chapter" : "chapter")} with hooks${verse > 0 ? ` (${plural(verse, "verse chapter")} left out)` : ""}`,
    `Outcomes: ${setbackShare}`,
    verse > 0 && verse === pacing.rows.length
      ? "Median chapter: none (no prose chapters)"
      : characterBook ? `Median chapter: ${pacing.medianCharacterCount} characters` : `Median chapter: ${pacing.medianWords} words`,
    ""
  ];
  if (pacing.rows.length === 0) {
    lines.push("- None: add chapters with story add chapter");
    return `${lines.join("\n")}\n`;
  }
  // Columns widen to their longest value, so a chapter 100 or a
  // 100,000-word chapter keeps its row aligned.
  const outcomesOf = (row) => `${row.outcomes.yes}/${row.outcomes.no}/${row.outcomes["yes-but"]}/${row.outcomes["no-and"]}`;
  const columns = [
    { title: "Ch", value: (row) => String(row.number) },
    characterBook ? { title: "Characters", value: (row) => String(row.characterCount) } : { title: "Words", value: (row) => String(row.words) },
    { title: "Scenes", value: (row) => String(row.scenes) },
    { title: "Sequels", value: (row) => String(row.sequels) },
    { title: "Outcomes (yes/no/yes-but/no-and)", value: outcomesOf, left: true }
  ].map((column) => ({ ...column, width: Math.max(column.title.length, ...pacing.rows.map((row) => column.value(row).length)) }));
  const cellText = (column, text) => (column.left ? text.padEnd(column.width) : text.padStart(column.width));
  lines.push(`${columns.map((column) => column.title.padEnd(column.width)).join("  ")}  Hook`);
  for (const row of pacing.rows) {
    lines.push(`${columns.map((column) => cellText(column, column.value(row))).join("  ")}  ${row.verse ? "(verse)" : row.hook || "-"}`);
  }
  return `${lines.join("\n")}\n`;
}

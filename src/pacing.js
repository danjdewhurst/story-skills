// Pacing dashboard: per-chapter scene and sequel counts, Swain scene
// outcomes, chapter-ending hooks, and length, plus advisory findings about
// runs that go slack. Reads frontmatter only; everything here is a warning.

export const SCENE_OUTCOMES = new Set(["yes", "no", "yes-but", "no-and"]);
export const CHAPTER_HOOKS = new Set(["cliffhanger", "question", "revelation", "reversal", "decision", "emotional", "resolution"]);

const DRAFTED_STATUSES = new Set(["draft", "revised", "final", "complete"]);
const EASY_WIN_RUN = 3;
const NO_SEQUEL_RUN = 4;
const RESOLUTION_RUN = 3;

export function buildPacing(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const warnings = [];
  const rows = [];
  const units = [];

  for (const chapter of chapters) {
    const scenes = project.scenes
      .filter((scene) => scene.chapter === chapter.id)
      .sort((left, right) => left.scene - right.scene || left.id.localeCompare(right.id, "en"));
    const outcomes = { yes: 0, no: 0, "yes-but": 0, "no-and": 0 };
    for (const scene of scenes) {
      if (!scene.sequel && SCENE_OUTCOMES.has(scene.outcome)) {
        outcomes[scene.outcome] += 1;
      }
      units.push(scene);
    }
    rows.push({
      id: chapter.id,
      number: chapter.number,
      words: chapter.wordCount,
      scenes: scenes.filter((scene) => !scene.sequel).length,
      sequels: scenes.filter((scene) => scene.sequel).length,
      outcomes,
      hook: chapter.hook,
      status: chapter.status
    });
    if (chapter.hook === "" && DRAFTED_STATUSES.has(chapter.status)) {
      warnings.push(`${chapter.id} has no hook: record how the chapter ending pulls the reader on`);
    }
  }

  // Runs are measured across scene records in reading order.
  let easyWins = [];
  let withoutSequel = [];
  for (const unit of units) {
    if (unit.sequel) {
      flushRun(withoutSequel, NO_SEQUEL_RUN, warnings, (run) => `${run.length} scene units in a row with no sequel (${span(run)}): give the POV character room to react and decide`);
      withoutSequel = [];
      continue;
    }
    withoutSequel.push(unit);
    if (unit.outcome === "yes") {
      easyWins.push(unit);
    } else {
      flushRun(easyWins, EASY_WIN_RUN, warnings, (run) => `${run.length} scenes in a row end in an outright yes (${span(run)}): raise the cost with yes-but or no-and`);
      easyWins = [];
    }
  }
  flushRun(easyWins, EASY_WIN_RUN, warnings, (run) => `${run.length} scenes in a row end in an outright yes (${span(run)}): raise the cost with yes-but or no-and`);
  flushRun(withoutSequel, NO_SEQUEL_RUN, warnings, (run) => `${run.length} scene units in a row with no sequel (${span(run)}): give the POV character room to react and decide`);

  let resolutions = [];
  for (const row of rows) {
    if (row.hook === "resolution") {
      resolutions.push(row);
    } else {
      flushRun(resolutions, RESOLUTION_RUN, warnings, (run) => `${run.length} chapters in a row end on resolution (${span(run)}): readers can put the book down`);
      resolutions = [];
    }
  }
  flushRun(resolutions, RESOLUTION_RUN, warnings, (run) => `${run.length} chapters in a row end on resolution (${span(run)}): readers can put the book down`);

  const written = rows.filter((row) => row.words > 0);
  const median = medianOf(written.map((row) => row.words));
  if (written.length >= 3) {
    for (const row of written) {
      if (row.words > median * 2) {
        warnings.push(`${row.id} runs ${row.words} words, over twice the median chapter (${median}): consider splitting it`);
      } else if (row.words < median / 2) {
        warnings.push(`${row.id} runs ${row.words} words, under half the median chapter (${median}): check it earns its place`);
      }
    }
  }

  const recorded = units.filter((unit) => !unit.sequel && SCENE_OUTCOMES.has(unit.outcome));
  return {
    rows,
    medianWords: median,
    totals: {
      scenes: units.filter((unit) => !unit.sequel).length,
      sequels: units.filter((unit) => unit.sequel).length,
      outcomesRecorded: recorded.length,
      setbacks: recorded.filter((unit) => unit.outcome !== "yes").length,
      hooks: rows.filter((row) => row.hook !== "").length
    },
    warnings
  };
}

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

function medianOf(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function formatPacing(pacing) {
  const { totals } = pacing;
  const setbackShare = totals.outcomesRecorded === 0 ? "no outcomes recorded" : `${Math.round((totals.setbacks * 100) / totals.outcomesRecorded)}% of recorded outcomes are setbacks or complications`;
  const lines = [
    `Pacing: ${totals.scenes} scenes, ${totals.sequels} sequels, ${totals.hooks} of ${pacing.rows.length} chapters with hooks`,
    `Outcomes: ${setbackShare}`,
    `Median chapter: ${pacing.medianWords} words`,
    ""
  ];
  if (pacing.rows.length === 0) {
    lines.push("- None: add chapters with story add chapter");
    return `${lines.join("\n")}\n`;
  }
  lines.push("Ch  Words  Scenes  Sequels  Outcomes (yes/no/yes-but/no-and)  Hook");
  for (const row of pacing.rows) {
    const outcomes = `${row.outcomes.yes}/${row.outcomes.no}/${row.outcomes["yes-but"]}/${row.outcomes["no-and"]}`;
    lines.push(`${String(row.number).padStart(2)}  ${String(row.words).padStart(5)}  ${String(row.scenes).padStart(6)}  ${String(row.sequels).padStart(7)}  ${outcomes.padEnd(32)}  ${row.hook || "-"}`);
  }
  return `${lines.join("\n")}\n`;
}

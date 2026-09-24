// Fair-play view over the clue registry: which chapter plants each clue and
// which reveals it, as a grid, plus advisory findings a mystery reader would
// notice. `story continuity` owns the hard ordering errors; everything here is
// a warning.

const LIVE_STATUSES = new Set(["planned", "planted", "paid-off"]);

export function buildClueMatrix(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const position = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  const warnings = [];
  const rows = [];

  const clues = [...project.clues].sort((left, right) => {
    const leftPlant = position.get(left.planted) ?? Infinity;
    const rightPlant = position.get(right.planted) ?? Infinity;
    return leftPlant - rightPlant || left.id.localeCompare(right.id, "en");
  });

  for (const clue of clues) {
    const label = `clue ${clue.id}`;
    const plantAt = position.get(clue.planted);
    const payoffAt = position.get(clue.payoff);
    rows.push({
      id: clue.id,
      title: clue.title,
      status: clue.status,
      redHerring: clue.redHerring,
      significanceDelayed: clue.significanceDelayed,
      cells: chapters.map((chapter, index) => cell(index === plantAt, index === payoffAt))
    });

    if (!LIVE_STATUSES.has(clue.status)) {
      continue;
    }
    if (clue.payoff !== "" && clue.planted === "") {
      warnings.push(`${label} is revealed in ${clue.payoff} but never planted: readers cannot play fair`);
    }
    if (plantAt !== undefined && payoffAt !== undefined && payoffAt - plantAt >= 0 && payoffAt - plantAt < 2) {
      const where = payoffAt === plantAt ? "the same chapter as" : "the chapter before";
      warnings.push(`${label} is planted in ${where} its reveal (${clue.planted} -> ${clue.payoff}): late plant gives readers no time to notice it`);
    }
    if (clue.characters.length === 0) {
      warnings.push(`${label} lists no characters: record who could notice it`);
    }
    if (clue.redHerring && clue.payoff === "") {
      warnings.push(`${label} is a red herring with no payoff: record the chapter that debunks it`);
    }
  }

  const live = project.clues.filter((clue) => LIVE_STATUSES.has(clue.status));
  const genuine = live.filter((clue) => !clue.redHerring);
  if (genuine.length >= 3 && !genuine.some((clue) => clue.significanceDelayed)) {
    warnings.push("no clue is significance-delayed: every clue announces its meaning when planted");
  }

  return {
    chapters: chapters.map((chapter) => ({ id: chapter.id, number: chapter.number })),
    rows,
    totals: {
      clues: live.length,
      redHerrings: live.filter((clue) => clue.redHerring).length,
      planted: live.filter((clue) => clue.planted !== "").length,
      revealed: live.filter((clue) => clue.payoff !== "").length
    },
    warnings
  };
}

function cell(planted, revealed) {
  if (planted && revealed) {
    return "x";
  }
  if (planted) {
    return "P";
  }
  if (revealed) {
    return "R";
  }
  return ".";
}

export function formatClueMatrix(matrix) {
  const { totals } = matrix;
  const herrings = `${totals.redHerrings} red herring${totals.redHerrings === 1 ? "" : "s"}`;
  const lines = [`Clues: ${totals.clues} live (${herrings}), ${totals.planted} planted, ${totals.revealed} revealed`];
  if (matrix.rows.length === 0) {
    lines.push("", "- None: add clues with story add clue \"Name\" --planted chapter-02 --payoff chapter-09");
    return `${lines.join("\n")}\n`;
  }

  const width = Math.max(...matrix.rows.map((row) => row.id.length + (row.redHerring ? 2 : 0)), 4);
  const header = matrix.chapters.map((chapter) => String(chapter.number).padStart(3)).join("");
  lines.push("", `${"Clue".padEnd(width)} ${header}`);
  for (const row of matrix.rows) {
    const name = row.redHerring ? `${row.id} ~` : row.id;
    const flags = [row.status];
    if (row.significanceDelayed) {
      flags.push("delayed");
    }
    lines.push(`${name.padEnd(width)} ${row.cells.map((value) => value.padStart(3)).join("")}  ${flags.join(", ")}`);
  }
  lines.push("", "P planted, R revealed, x both, ~ red herring");
  return `${lines.join("\n")}\n`;
}

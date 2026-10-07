// Plot grid: arcs as rows and chapters as columns, as Plottr and Scrivener's
// outliner lay a book out, built from each chapter's (and its scenes')
// arcs-advanced, plus a row for each chapter's beat (once any chapter has
// one), one for its hook, and one for its scene outcomes. A view only:
// unknown arc ids are validate errors, so the grid shows them as rows but
// raises no finding of its own.

import { usageError } from "./exit-codes.js";
import { SCENE_OUTCOMES } from "./pacing.js";
import { displayWidth } from "./unicode.js";

export const GRID_FORMATS = ["markdown", "csv"];

// The labels of the rows below the arcs. Parentheses cannot appear in an arc
// id, so they never clash with one.
const BEAT_ROW = "(beat)";
const HOOK_ROW = "(hook)";
const OUTCOME_ROW = "(outcomes)";

// `from` and `to` (a chapter id or number) narrow the columns to a range of
// a wide book; arcs keep their order from the whole book.
export function buildGrid(project, options = {}) {
  const all = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const start = options.from === undefined ? 0 : chapterIndex(all, options.from, "--from");
  const end = options.to === undefined ? all.length - 1 : chapterIndex(all, options.to, "--to");
  if (all.length > 0 && start > end) {
    throw usageError(`--from ${options.from} comes after --to ${options.to}: give the earlier chapter first`, ["from", "to"]);
  }

  // Each chapter's arcs, from its own frontmatter and its scenes'.
  const advanced = new Map(all.map((chapter) => [chapter.id, new Set(chapter.arcsAdvanced.map(String))]));
  const scenes = new Map(all.map((chapter) => [chapter.id, []]));
  for (const scene of project.scenes) {
    if (!advanced.has(scene.chapter)) {
      continue;
    }
    scene.arcsAdvanced.forEach((arcId) => advanced.get(scene.chapter).add(String(arcId)));
    scenes.get(scene.chapter).push(scene);
  }

  // Arcs in the order the book first advances them, then those it never
  // does; ids no arc file defines come last.
  const first = new Map();
  all.forEach((chapter, index) => {
    for (const arcId of advanced.get(chapter.id)) {
      if (!first.has(arcId)) {
        first.set(arcId, index);
      }
    }
  });
  const byFirst = (left, right) => (first.get(left.id) ?? Infinity) - (first.get(right.id) ?? Infinity) || left.id.localeCompare(right.id, "en");
  const known = new Set(project.arcs.map((arc) => arc.id));
  const arcs = [
    ...project.arcs.map((arc) => ({ id: arc.id, name: String(arc.name), status: String(arc.status), known: true })).sort(byFirst),
    ...[...first.keys()].filter((id) => !known.has(id)).map((id) => ({ id, name: null, status: null, known: false })).sort(byFirst)
  ];

  const chapters = all.slice(start, end + 1);
  return {
    range: { from: chapters[0]?.id ?? null, to: chapters.at(-1)?.id ?? null, total: all.length },
    // Whether any chapter in the whole book records a beat, and so whether
    // the grid has a beat row: a range of chapters with none still shows
    // the same rows as the rest of the book.
    beats: all.some((chapter) => chapter.beat !== ""),
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      number: chapter.number,
      title: String(chapter.title),
      beat: chapter.beat,
      hook: chapter.hook,
      // Scene outcomes in scene order; sequels have none.
      outcomes: scenes.get(chapter.id)
        .filter((scene) => !scene.sequel && SCENE_OUTCOMES.has(scene.outcome))
        .sort((left, right) => left.scene - right.scene || left.id.localeCompare(right.id, "en"))
        .map((scene) => scene.outcome)
    })),
    rows: arcs.map((arc) => ({ ...arc, cells: chapters.map((chapter) => advanced.get(chapter.id).has(arc.id)) }))
  };
}

// A --from or --to value: a chapter id, or a chapter number.
function chapterIndex(chapters, value, flag) {
  const text = String(value).trim();
  let index = chapters.findIndex((chapter) => chapter.id === text);
  if (index === -1 && /^\d+$/.test(text)) {
    index = chapters.findIndex((chapter) => chapter.number === Number(text));
  }
  if (index === -1) {
    throw usageError(`${flag} ${value} is not a chapter in this project: give a chapter id (chapter-03) or number (3)`, flag.slice(2));
  }
  return index;
}

export function gridFormat(value) {
  const format = value === undefined ? "markdown" : String(value);
  if (!GRID_FORMATS.includes(format)) {
    throw usageError(`Unknown grid format: ${value} (use ${GRID_FORMATS.join(" or ")})`, "format");
  }
  return format;
}

// The grid as a table of strings: a header row of chapter numbers, a row
// per arc with x where the chapter advances it, then the beat row in a book
// with beats, and the hook and outcome rows.
function gridTable(grid) {
  const header = ["Arc", ...grid.chapters.map((chapter) => String(chapter.number))];
  const arcRows = grid.rows.map((row) => [row.known ? row.id : `${row.id} (unknown)`, ...row.cells.map((cell) => (cell ? "x" : ""))]);
  return [
    header,
    ...arcRows,
    ...(grid.beats ? [[BEAT_ROW, ...grid.chapters.map((chapter) => chapter.beat)]] : []),
    [HOOK_ROW, ...grid.chapters.map((chapter) => chapter.hook)],
    [OUTCOME_ROW, ...grid.chapters.map((chapter) => chapter.outcomes.join(", "))]
  ];
}

export function formatGrid(grid, format = "markdown") {
  const table = gridTable(grid);
  return format === "csv" ? formatCsv(table) : formatMarkdown(table);
}

// Every column is padded to its widest cell, so chapter 100 lines up with
// chapter 9 and the source reads as a grid too. Widths are terminal columns,
// so a beat in Chinese or with an emoji lines up as well.
function formatMarkdown(table) {
  const escaped = table.map((row) => row.map((cell) => cell.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")));
  const widths = escaped[0].map((_, column) => Math.max(3, ...escaped.map((row) => displayWidth(row[column]))));
  const line = (cells) => `| ${cells.map((cell, column) => cell + " ".repeat(widths[column] - displayWidth(cell))).join(" | ")} |`;
  const rule = `|${widths.map((width, column) => (column === 0 ? "-".repeat(width + 2) : `:${"-".repeat(width)}:`)).join("|")}|`;
  return `${[line(escaped[0]), rule, ...escaped.slice(1).map(line)].join("\n")}\n`;
}

function formatCsv(table) {
  return table.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

// A cell a spreadsheet would read as a formula (=, +, -, or @ first, or a
// tab or carriage return, which some read past) gets a ' first, so a beat
// or arc id opens as the text it is.
function csvCell(value) {
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

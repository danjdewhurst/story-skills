// `story submissions [path]`: reads the submission tracker the `submission`
// skill keeps, `submission/tracker.md`, and reports its rows, the count of
// each status, and the rows still waiting for a reply after a number of
// days. It checks each row's status and dates. Nothing is written: every row
// comes from the author, so the command only reads them.
//
// The tracker is markdown: optional YAML frontmatter, then a table whose
// header names a Status and a Date Sent column. A book's tracker has
// Agent/Publisher, Date Sent, Materials, Status, Response Date, and Notes;
// a short-fiction tracker has Market, Story, Date Sent, Type, Rights
// Offered, Status, Response Date, and Notes. Columns are found by their
// header, so their order does not matter, and any other table (such as the
// Publication History) is left alone.
import path from "node:path";
import { parseClockDate } from "./continuity.js";
import { projectError, usageError } from "./exit-codes.js";
import { assertSafeProjectDirectory, lstatIfExists, readTextFile } from "./files.js";
import { err, outputText, warn } from "./findings.js";
import { parseFrontmatter } from "./frontmatter.js";
import { fencedLineIndexes } from "./markdown.js";
import { plural } from "./plural.js";
import { requireStoryFile } from "./scan-files.js";

export const SUBMISSION_TRACKER = "submission/tracker.md";

// Every tracker status, in the order the skill's template lists them.
export const SUBMISSION_STATUSES = ["queried", "submitted", "held", "requested-partial", "requested-full", "offer", "declined", "no-response", "withdrawn"];

// The statuses that wait for a reply from the agent, publisher, or market.
// A request waits for the answer to the partial or full the author sent.
export const WAITING_STATUSES = new Set(["queried", "submitted", "held", "requested-partial", "requested-full"]);

export const DEFAULT_FOLLOW_UP_DAYS = 90;

// A tracker holds one row per submission: some hundreds for a busy writer.
// A file with far more is refused before the rows, and a finding for each,
// can fill a terminal, a CI log, or the memory --json needs.
export const MAX_TRACKER_ROWS = 10000;

// Each row's submission-overdue finding, so recountOverdue can tell which
// rows story.md severity or an exemption has dismissed.
const OVERDUE_FINDINGS = new WeakMap();
const MAX_FOLLOW_UP_DAYS = 3650;

// The days from --days after which a submission still waiting for a reply
// is due a follow-up: a whole number 1 to 3650, default 90.
export function followUpDays(options = {}) {
  const raw = options.days;
  if (raw === undefined) {
    return DEFAULT_FOLLOW_UP_DAYS;
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > MAX_FOLLOW_UP_DAYS) {
    throw usageError(`--days must be a whole number 1 to ${MAX_FOLLOW_UP_DAYS}, such as ${DEFAULT_FOLLOW_UP_DAYS}`, "days");
  }
  return Number(text);
}

// The columns a tracker row is read from, by header name (lower case, with
// emphasis and spacing taken out).
const COLUMNS = new Map([
  ["story", "story"],
  ["date sent", "dateSent"],
  ["materials", "materials"],
  ["type", "type"],
  ["rights offered", "rights"],
  ["status", "status"],
  ["response date", "responseDate"],
  ["notes", "notes"]
]);

const DELIMITER_ROW = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

// A table line's cells: split on pipes not escaped with a backslash, with
// the outer pipes taken off and `\|` read as a pipe.
function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

const MARKS = new Set(["*", "_", "`"]);

// A cell without the emphasis or code marks around its text: the same mark
// taken off both ends while it is on both, so **2026-06-01** and `queried`
// read as their text. A loop rather than a backreference keeps a long run of
// marks linear.
function plainCell(cell) {
  let text = cell.trim();
  while (text.length >= 2 && MARKS.has(text[0]) && text.at(-1) === text[0]) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function headerName(cell) {
  return plainCell(cell).toLowerCase().replace(/\s+/g, " ");
}

// The tracker tables in `lines` (the file's lines, frontmatter included,
// with `start` the first line after it), each as { headers, rows }, where a
// row is { line, cells } with line counted from 1.
function trackerTables(lines, start) {
  const fenced = fencedLineIndexes(lines);
  const tables = [];
  for (let index = start; index < lines.length - 1; index += 1) {
    if (fenced.has(index) || !lines[index].trim().startsWith("|") || !DELIMITER_ROW.test(lines[index + 1].trim())) {
      continue;
    }
    const headers = tableCells(lines[index]).map(headerName);
    const rows = [];
    let next = index + 2;
    for (; next < lines.length && !fenced.has(next) && lines[next].trim().startsWith("|"); next += 1) {
      rows.push({ line: next + 1, cells: tableCells(lines[next]) });
    }
    if (headers.includes("status") && headers.includes("date sent")) {
      tables.push({ headers, rows });
    }
    index = next - 1;
  }
  return tables;
}

// The template's placeholder row, `| *No submissions yet* | | | ... |`: that
// text in the first cell and nothing else.
function placeholderRow(cells) {
  return plainCell(cells[0] ?? "").toLowerCase() === "no submissions yet" && cells.slice(1).every((cell) => cell === "");
}

// A row as { line, name, story, dateSent, ... }, each column's text without
// the emphasis or code marks around it, or null for a column the table does
// not have. `name` is the first column that is
// none of the known ones: Agent/Publisher, or Market.
function trackerRow(headers, { line, cells }) {
  const row = { line, name: "" };
  for (const field of COLUMNS.values()) {
    row[field] = null;
  }
  let named = false;
  for (const [index, header] of headers.entries()) {
    const field = COLUMNS.get(header);
    const cell = plainCell(cells[index] ?? "");
    if (field !== undefined) {
      row[field] = cell;
    } else if (!named) {
      row.name = cell;
      named = true;
    }
  }
  return row;
}

function rowLabel(row) {
  const name = row.name;
  return `${SUBMISSION_TRACKER} line ${row.line}${name === "" ? "" : ` (${name})`}`;
}

// The tracker's text as { start, lines }: its lines, and the index of the
// first one after any frontmatter.
function trackerLines(text) {
  if (!/^---[ \t]*\r?\n/.test(text)) {
    return { start: 0, lines: text.split(/\r?\n/) };
  }
  let body;
  try {
    body = parseFrontmatter(text, SUBMISSION_TRACKER).body;
  } catch (error) {
    throw projectError(`${SUBMISSION_TRACKER} cannot be parsed: ${error.message}`);
  }
  const head = text.slice(0, text.length - body.length);
  return { start: head.split(/\r?\n/).length - 1, lines: text.split(/\r?\n/) };
}

// Reads `submission/tracker.md` under `root`, or returns null when there is
// none. A submission folder that is a symlink or leads out of the project is
// refused, as every project folder is.
export function readTracker(root) {
  const folder = path.join(root, "submission");
  if (lstatIfExists(folder) === null) {
    return null;
  }
  assertSafeProjectDirectory(folder, root);
  const file = path.join(root, SUBMISSION_TRACKER);
  if (lstatIfExists(file) === null) {
    return null;
  }
  return readTextFile(file);
}

// The tracker's rows checked against `today` (YYYY-MM-DD) and `days`, the
// days a row may wait for a reply before it is due a follow-up.
export function submissionsReport(root, { today, days = DEFAULT_FOLLOW_UP_DAYS }) {
  requireStoryFile(root);
  const text = readTracker(root);
  const counts = Object.fromEntries(SUBMISSION_STATUSES.map((status) => [status, 0]));
  const result = { root, file: SUBMISSION_TRACKER, found: text !== null, today, days, rows: [], counts, waiting: 0, overdue: 0, ok: true, errors: [], warnings: [] };
  if (text === null) {
    return result;
  }
  const { start, lines } = trackerLines(text);
  const tables = trackerTables(lines, start);
  if (tables.length === 0) {
    result.errors.push(err("submission-tracker-no-table", `${SUBMISSION_TRACKER} has no tracker table: add one with a Status and a Date Sent column, as the submission skill's tracker template has`, SUBMISSION_TRACKER));
  }
  const rowCount = tables.reduce((total, table) => total + table.rows.length, 0);
  if (rowCount > MAX_TRACKER_ROWS) {
    result.errors.push(err("submission-tracker-too-large", `${SUBMISSION_TRACKER} has ${rowCount} table rows, more than the ${MAX_TRACKER_ROWS} a tracker can hold: split it, or move old rows to another file`, SUBMISSION_TRACKER));
    result.ok = false;
    return result;
  }
  const todayDays = parseClockDate(today).days;
  for (const table of tables) {
    for (const cells of table.rows) {
      if (placeholderRow(cells.cells)) {
        continue;
      }
      result.rows.push(checkRow(trackerRow(table.headers, cells), todayDays, days, result));
    }
  }
  result.waiting = result.rows.filter((row) => row.waitingSince !== null).length;
  result.overdue = result.rows.filter((row) => row.overdue).length;
  result.ok = result.errors.length === 0;
  return result;
}

// Checks one row's status and dates, counts its status, and adds how long
// it has waited: from the later of Date Sent and Response Date, so a
// request for the full manuscript waits from the day it came.
function checkRow(row, todayDays, days, result) {
  const label = rowLabel(row);
  const status = (row.status ?? "").toLowerCase();
  row.status = status;
  if (status === "") {
    result.errors.push(err("submission-invalid-status", `${label}: Status is empty; use one of ${SUBMISSION_STATUSES.join(", ")}`, SUBMISSION_TRACKER));
  } else if (!SUBMISSION_STATUSES.includes(status)) {
    result.errors.push(err("submission-invalid-status", `${label}: Status "${status}" is not a tracker status; use one of ${SUBMISSION_STATUSES.join(", ")}`, SUBMISSION_TRACKER));
  } else {
    result.counts[status] += 1;
  }
  const sent = rowDate(row, "dateSent", "Date Sent", label, result, { required: true });
  const response = rowDate(row, "responseDate", "Response Date", label, result, { required: false });
  const since = [sent, response].filter((date) => date !== undefined).sort((left, right) => right.days - left.days)[0];
  row.waitingSince = null;
  row.waitingDays = null;
  row.overdue = false;
  if (WAITING_STATUSES.has(status) && since !== undefined) {
    row.waitingSince = since.text;
    row.waitingDays = todayDays - since.days;
    row.overdue = row.waitingDays >= days;
    if (row.overdue) {
      const finding = warn("submission-overdue", `${label}: ${status}, waiting ${plural(row.waitingDays, "day")} for a reply since ${since.text} (${days} or more is due a follow-up): follow up, or record the reply`, SUBMISSION_TRACKER);
      OVERDUE_FINDINGS.set(row, finding);
      result.warnings.push(finding);
    }
  }
  return row;
}

// A row's date column as { text, days }, or undefined when it is blank or
// not a date. A Date Sent is required; a Response Date stays blank until a
// reply comes.
function rowDate(row, field, column, label, result, { required }) {
  if (row[field] === null) {
    return undefined;
  }
  const text = row[field];
  if (text === "") {
    if (required) {
      result.errors.push(err("submission-invalid-date", `${label}: ${column} is empty; write the date as YYYY-MM-DD`, SUBMISSION_TRACKER));
    }
    return undefined;
  }
  const date = parseClockDate(text);
  if (date === undefined) {
    result.errors.push(err("submission-invalid-date", `${label}: ${column} "${text}" must be a real YYYY-MM-DD calendar day`, SUBMISSION_TRACKER));
  }
  return date;
}

// The report after applySeverity: a row whose submission-overdue warning
// story.md severity turned off, or an exemption dismissed, is no longer due
// a follow-up, in the rows, the overdue count, and story next alike.
export function recountOverdue(report) {
  const active = new Set([...report.errors, ...report.warnings]);
  const rows = report.rows.map((row) => ({ ...row, overdue: row.overdue && active.has(OVERDUE_FINDINGS.get(row)) }));
  return { ...report, rows, overdue: rows.filter((row) => row.overdue).length };
}

// The tracker report for story next, or null when the tracker cannot be
// read: story submissions reports that, and next is not where to.
export function trackerForNext(root, options) {
  try {
    return submissionsReport(root, options);
  } catch {
    return null;
  }
}

export function formatSubmissions(report) {
  if (!report.found) {
    return `No submission tracker: ${SUBMISSION_TRACKER} does not exist yet. The submission skill creates it when the first submission goes out.\n`;
  }
  const lines = [`# Submissions: ${SUBMISSION_TRACKER}`, "", `Today: ${report.today}; follow up after ${plural(report.days, "day")} or more without a reply`, ""];
  if (report.rows.length === 0 && report.errors.length === 0) {
    lines.push("No submissions recorded yet.");
  }
  for (const row of report.rows) {
    lines.push(`- ${formatRow(row)}`);
  }
  const counted = SUBMISSION_STATUSES.filter((status) => report.counts[status] > 0).map((status) => `${status} ${report.counts[status]}`);
  lines.push(
    "",
    `Counts: ${counted.length === 0 ? "none" : counted.join(", ")} (${plural(report.rows.length, "submission")})`,
    `Waiting for a reply: ${report.waiting}; due a follow-up: ${report.overdue}`
  );
  return `${lines.join("\n")}\n`;
}

function formatRow(row) {
  const name = outputText(row.name) || "(no name)";
  const story = row.story ? ` [${outputText(row.story)}]` : "";
  const status = row.status === "" ? "(no status)" : outputText(row.status);
  const sent = row.dateSent ? ` sent ${outputText(row.dateSent)}` : "";
  const response = row.responseDate ? `, reply ${outputText(row.responseDate)}` : "";
  let waiting = "";
  if (row.waitingDays !== null && row.waitingDays >= 0) {
    waiting = `; waiting ${plural(row.waitingDays, "day")}${row.overdue ? ": follow up" : ""}`;
  }
  return `${name}${story}: ${status}${sent ? `,${sent}` : ""}${response}${waiting}`;
}


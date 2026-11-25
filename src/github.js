import fs from "node:fs";
import path from "node:path";
import { usageError } from "./exit-codes.js";
import { portablePath, readTextFile } from "./files.js";
import { findingMessage, findingRange } from "./finding-locations.js";
import { outputText } from "./findings.js";

// `story check --format github`: the findings as GitHub Actions workflow
// commands, so a pull request shows each one on the file and line it is
// about, and, when the job sets GITHUB_STEP_SUMMARY, as a table on the run's
// summary page. The text report still goes to stderr as before.

export const CHECK_FORMATS = ["text", "github"];

// The step summary lists this many findings; the rest are in the job log.
export const SUMMARY_ROW_LIMIT = 200;

export function checkFormat(value) {
  const format = value === undefined ? "text" : String(value);
  if (!CHECK_FORMATS.includes(format)) {
    throw usageError(`Unknown check format: ${value} (use ${CHECK_FORMATS.join(" or ")})`, "format");
  }
  return format;
}

// Project text in a workflow command. outputText first turns every control
// character, line break included, into a \u escape, so the text cannot end
// the command or start one of its own; then the runner's own escapes apply:
// `%`, CR, and LF in the message, and `:` and `,` too in a property value.
function escapeData(text) {
  return outputText(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(text) {
  return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

// Text in a markdown table cell: control characters escaped, and the
// punctuation that markdown or HTML reads inline backslash-escaped, so a
// finding that quotes project text cannot add a link, an image, a tag,
// emphasis, or a column.
function markdownCell(text) {
  return outputText(text).replace(/[\\`*_[\]<>!|~&]/g, "\\$&");
}

// Where each finding is, as the annotation names it: the file relative to
// the repository (GITHUB_WORKSPACE, else the working directory), with `/`,
// and the 1-based first and last line the language server would underline.
// A finding about no file, or about a file that cannot be read, has no
// line; one about no file has no path either.
function locate(projectRoot, workspace, findings) {
  const texts = new Map();
  const textOf = (file) => {
    if (!texts.has(file)) {
      let text = null;
      try {
        text = readTextFile(file);
      } catch {
        // A missing or unreadable file still gets its annotation, unplaced.
      }
      texts.set(file, text);
    }
    return texts.get(file);
  };
  return findings.map(({ level, finding }) => {
    if (typeof finding.file !== "string" || finding.file === "") {
      return { level, finding, file: null, line: null, endLine: null };
    }
    const absolute = path.resolve(projectRoot, finding.file);
    const file = portablePath(path.relative(workspace, absolute));
    const text = textOf(absolute);
    if (text === null) {
      return { level, finding, file, line: null, endLine: null };
    }
    const range = findingRange(text, finding);
    return { level, finding, file, line: range.start.line + 1, endLine: range.end.line + 1 };
  });
}

function levelled(result) {
  return [
    ...result.errors.map((finding) => ({ level: "error", finding })),
    ...result.warnings.map((finding) => ({ level: "warning", finding }))
  ];
}

// The message without the file label it opens with, as the language server
// shows it, when the annotation sits on a line of that file. An annotation
// with no line keeps the label, since GitHub then shows it apart from the
// file.
function annotationMessage(finding, line) {
  return line === null ? finding.message : findingMessage(finding);
}

// One workflow command per error and warning. Dismissed findings get none:
// an exemption has accepted them.
export function githubAnnotations(located) {
  return located.map(({ level, finding, file, line, endLine }) => {
    const properties = [];
    if (file !== null) {
      properties.push(`file=${escapeProperty(file)}`);
    }
    if (line !== null) {
      properties.push(`line=${line}`, `endLine=${endLine}`);
    }
    properties.push(`title=${escapeProperty(finding.code)}`);
    return `::${level} ${properties.join(",")}::${escapeData(annotationMessage(finding, line))}\n`;
  }).join("");
}

export function githubSummary(located, result, heading) {
  const dismissed = result.dismissed ?? [];
  const lines = [
    `## ${heading}`,
    "",
    `${result.errors.length} errors, ${result.warnings.length} warnings, ${dismissed.length} dismissed`,
    ""
  ];
  if (located.length > 0) {
    lines.push("| Level | File | Line | Finding | Code |", "|---|---|---|---|---|");
    for (const { level, finding, file, line } of located.slice(0, SUMMARY_ROW_LIMIT)) {
      lines.push(`| ${level} | ${file === null ? "" : markdownCell(file)} | ${line ?? ""} | ${markdownCell(annotationMessage(finding, line))} | ${markdownCell(finding.code)} |`);
    }
    if (located.length > SUMMARY_ROW_LIMIT) {
      lines.push("", `${located.length - SUMMARY_ROW_LIMIT} more findings are in the job log.`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

// Prints the annotations to stdout and, when `env` names a step summary
// file, appends the summary table to it. A summary that cannot be written
// is a note on stderr; it never changes the exit code, which the findings
// set. The annotations go to `io.workflowStdout`, the stdout that runCli
// leaves unescaped, since its usual stdout escapes the `::` that starts a
// workflow command: every value in them is escaped here instead.
export function reportGithub(io, projectRoot, result, { env = process.env, cwd = process.cwd(), heading = "Story checks" } = {}) {
  const workspace = typeof env.GITHUB_WORKSPACE === "string" && env.GITHUB_WORKSPACE !== "" ? path.resolve(env.GITHUB_WORKSPACE) : path.resolve(cwd);
  const located = locate(projectRoot, workspace, levelled(result));
  (io.workflowStdout ?? io.stdout).write(githubAnnotations(located));
  const summary = env.GITHUB_STEP_SUMMARY;
  if (typeof summary === "string" && summary !== "") {
    try {
      fs.appendFileSync(summary, githubSummary(located, result, heading), "utf8");
    } catch (error) {
      io.stderr.write(`note: could not write the step summary: ${outputText(error.message)}\n`);
    }
  }
}

import { EXIT_CODES } from "./exit-codes.js";
import { asFinding } from "./findings.js";
import { isTruthy } from "./options.js";

// The version of the --json result envelope. Adding a field keeps it;
// renaming, removing, or retyping one bumps it. schemas/result.schema.json
// describes this version.
export const API_VERSION = "story/v1";

export function wantsJson(parsed) {
  return isTruthy(parsed.options.json);
}

// Prints one --json result object on stdout and returns the exit code that
// matches its `ok`: 0 when it is true, else `exitCode` (a code from
// exit-codes.js saying why the command failed), which defaults to findings.
// Every command with --json output calls this, and nothing else is printed,
// so stdout parses as a single JSON document.
export function writeJsonResult(io, { command, ok, exitCode = EXIT_CODES.findings, data = null, diagnostics = [], writes = [] }) {
  const envelope = { apiVersion: API_VERSION, command, ok: Boolean(ok), data, diagnostics, writes };
  // A field a result leaves undefined prints as null, so every result of a
  // command has the same keys.
  io.stdout.write(`${JSON.stringify(envelope, (key, value) => (value === undefined ? null : value), 2)}\n`);
  return envelope.ok ? EXIT_CODES.ok : exitCode;
}

// A check result's errors, warnings, and dismissed findings as diagnostics.
// `code` names the check that raised them.
export function diagnosticsFrom(result, code) {
  return [
    ...(result.errors ?? []).map((message) => diagnostic("error", message, code)),
    ...(result.warnings ?? []).map((message) => diagnostic("warning", message, code)),
    ...(result.dismissed ?? []).map((entry) => ({ ...diagnostic("dismissed", entry.finding, code), exemption: entry.reason }))
  ];
}

export function diagnostic(severity, message, code) {
  const text = asFinding(message).message;
  return { severity, file: messageFile(text), message: text, code };
}

// Findings name their file first (`chapters/chapter-02.md references ...`),
// so the leading path, when there is one, is the file the finding is about.
function messageFile(message) {
  const match = /^(\S+?\.(?:md|ya?ml|json))(?=[\s:[]|$)/u.exec(message);
  return match ? match[1] : null;
}

// A check result without the fields the envelope already carries.
export function resultData(result) {
  const { ok, errors, warnings, dismissed, ...data } = result;
  return data;
}
